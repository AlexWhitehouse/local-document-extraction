package pipeline

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestProviderWaitReleasesUploadCapacityAndResumesBeforeReading(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resume := make(chan struct{})
	resuming := make(chan struct{}, 1)
	uploaded := make(chan struct{})
	modelResponse := make(chan struct{})
	var suspended atomic.Bool
	bridgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "capacity/suspend"):
			suspended.Store(true)
		case strings.HasSuffix(r.URL.Path, "capacity/resume"):
			resuming <- struct{}{}
			select {
			case <-resume:
			case <-ctx.Done():
				return
			}
			suspended.Store(false)
		case strings.HasSuffix(r.URL.Path, "call/start"):
			io.WriteString(w, `{"id":"receipt"}`)
			return
		}
		io.WriteString(w, `{}`)
	}))
	defer bridgeServer.Close()
	gateway := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor != 2 {
			t.Errorf("expected negotiated HTTP/2, got %s", r.Proto)
		}
		io.Copy(io.Discard, r.Body)
		close(uploaded)
		select {
		case <-modelResponse:
		case <-ctx.Done():
			return
		}
		io.WriteString(w, `{"usage":{"cost":0.01},"choices":[]}`)
	}))
	gateway.EnableHTTP2 = true
	gateway.StartTLS()
	defer gateway.Close()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.pdf")
	if err := os.WriteFile(source, []byte("source bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	transport := NewTransport(nil, nil, 1500, 1<<30, 512<<20)
	roots := x509.NewCertPool()
	roots.AddCert(gateway.Certificate())
	transport.HTTP.Transport.(*http.Transport).TLSClientConfig = &tls.Config{RootCAs: roots}
	bridge := &Bridge{URL: bridgeServer.URL, HTTP: bridgeServer.Client()}
	artifact := filepath.Join(dir, "artifact-test")
	if err := os.WriteFile(artifact, []byte("prepared PDF"), 0600); err != nil {
		t.Fatal(err)
	}
	if !transport.Artifacts.tryAcquire(12) {
		t.Fatal("reservation failed")
	}
	cache := &preparationCache{paths: map[string][]string{source + "[]false": {artifact}}, bytes: 12}
	done := make(chan error, 1)
	go func() {
		_, err := transport.Call(ctx, "workspace", ModelTask{Final: true, URL: gateway.URL, Source: source, Mime: "application/pdf", Prefix: "[", Suffix: "]"}, dir, cache, bridge)
		done <- err
	}()
	select {
	case <-uploaded:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if !suspended.Load() {
		t.Fatal("provider wait retained processing permit")
	}
	// WroteRequest runs as the upload finishes, independently of the provider delay.
	deadline := time.Now().Add(time.Second)
	for transport.Uploading.Load() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if transport.Uploading.Load() != 0 || transport.InFlight.Load() != 1 {
		t.Fatal("upload and provider capacity not independent")
	}
	for transport.Artifacts.Used() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if transport.Artifacts.Used() != 0 {
		t.Fatal("final-stage artifacts retained during provider wait")
	}
	if _, err := os.Stat(artifact); !os.IsNotExist(err) {
		t.Fatal("prepared PDF retained after upload")
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal("durable source removed before commit")
	}
	close(modelResponse)
	select {
	case <-resuming:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case <-done:
		t.Fatal("response processed before resume")
	default:
	}
	close(resume)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if cache.responseBytes == 0 || transport.Responses.Used() != cache.responseBytes {
		t.Fatal("response credit released before normalization")
	}
	transport.releaseResponse(cache)
	if transport.Responses.Used() != 0 {
		t.Fatal("response credit leaked")
	}
	if transport.InFlight.Load() != 0 || transport.Uploading.Load() != 0 {
		t.Fatal("capacity leaked")
	}
}
