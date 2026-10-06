package pipeline

import (
	"bytes"
	"context"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"document-extraction.local/backend/internal/pdf"
)

func TestBudgetGrantsWaitersInOrder(t *testing.T) {
	b := newByteBudget(100)
	if !b.tryAcquire(100) {
		t.Fatal("initial reservation failed")
	}
	order := make(chan int, 2)
	for i, size := range []int64{60, 30} {
		go func() {
			if err := b.acquire(context.Background(), size); err != nil {
				t.Error(err)
			}
			order <- i
		}()
		for {
			b.mu.Lock()
			queued := len(b.waiters)
			b.mu.Unlock()
			if queued == i+1 {
				break
			}
			time.Sleep(time.Millisecond)
		}
	}
	if b.tryAcquire(1) {
		t.Fatal("tryAcquire overtook waiters")
	}
	// 40 bytes fit the second waiter but not the first: FIFO keeps both waiting.
	b.release(40)
	select {
	case <-order:
		t.Fatal("later waiter overtook the queue head")
	case <-time.After(20 * time.Millisecond):
	}
	b.release(20)
	if first := <-order; first != 0 {
		t.Fatalf("waiter %d granted before the queue head", first)
	}
	b.release(30)
	if second := <-order; second != 1 {
		t.Fatalf("unexpected grant %d", second)
	}
	if b.Used() != 100 {
		t.Fatalf("used %d", b.Used())
	}
}

type countingBridge struct {
	mu    sync.Mutex
	calls []string
}

func (c *countingBridge) server(t *testing.T) *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		c.calls = append(c.calls, strings.TrimPrefix(r.URL.Path, "/"))
		c.mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "call/start") {
			io.WriteString(w, `{"id":"receipt"}`)
			return
		}
		io.WriteString(w, `{}`)
	}))
	t.Cleanup(server.Close)
	return server
}

func (c *countingBridge) recorded() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.Join(c.calls, ",")
}

func TestFreeResourcesNeedNoCapacityRoundTrips(t *testing.T) {
	recorder := &countingBridge{}
	bridgeServer := recorder.server(t)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		io.WriteString(w, `{"choices":[]}`)
	}))
	defer gateway.Close()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.pdf")
	if err := os.WriteFile(source, []byte("source"), 0o600); err != nil {
		t.Fatal(err)
	}
	transport := NewTransport(nil, nil, 4, 1<<30, 64<<20)
	bridge := &Bridge{URL: bridgeServer.URL, HTTP: bridgeServer.Client()}
	cache := &preparationCache{paths: map[string][]string{source + "[]false": {source}}}
	if _, err := transport.Call(context.Background(), "workspace", ModelTask{URL: gateway.URL, Source: source, Mime: "application/pdf", Sequential: true}, dir, cache, bridge); err != nil {
		t.Fatal(err)
	}
	// call/start releases the permit; only the response read needs it back.
	if got := recorder.recorded(); got != "call/start,capacity/resume" {
		t.Fatalf("bridge calls %s", got)
	}
	transport.releaseResponse(cache)
}

func TestUnknownLengthResponseGrowsCreditInsteadOfReservingTheLimit(t *testing.T) {
	recorder := &countingBridge{}
	bridgeServer := recorder.server(t)
	answer := `{"choices":[{"message":{"content":"` + strings.Repeat("x", 3<<20) + `"}}]}`
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		// Flushing before the end forces chunked encoding: no Content-Length.
		io.WriteString(w, answer[:10])
		w.(http.Flusher).Flush()
		io.WriteString(w, answer[10:])
	}))
	defer gateway.Close()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.pdf")
	if err := os.WriteFile(source, []byte("source"), 0o600); err != nil {
		t.Fatal(err)
	}
	// An 8 MiB allowance could never hold the old 32 MiB unknown-length reservation.
	transport := NewTransport(nil, nil, 4, 1<<30, 8<<20)
	bridge := &Bridge{URL: bridgeServer.URL, HTTP: bridgeServer.Client()}
	cache := &preparationCache{paths: map[string][]string{source + "[]false": {source}}}
	body, err := transport.Call(context.Background(), "workspace", ModelTask{URL: gateway.URL, Source: source, Mime: "application/pdf", MaximumResponseBytes: 32 << 20}, dir, cache, bridge)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != answer || cache.responseBytes != int64(len(answer)) || transport.Responses.Used() != int64(len(answer)) {
		t.Fatalf("credit %d used %d for %d bytes", cache.responseBytes, transport.Responses.Used(), len(answer))
	}
	transport.releaseResponse(cache)
	if transport.Responses.Used() != 0 {
		t.Fatal("response credit leaked")
	}
}

func TestOversizedResponseIsRejectedAtTheLimit(t *testing.T) {
	recorder := &countingBridge{}
	bridgeServer := recorder.server(t)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.(http.Flusher).Flush()
		io.WriteString(w, strings.Repeat("x", 2048))
	}))
	defer gateway.Close()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.pdf")
	if err := os.WriteFile(source, []byte("source"), 0o600); err != nil {
		t.Fatal(err)
	}
	transport := NewTransport(nil, nil, 4, 1<<30, 64<<20)
	bridge := &Bridge{URL: bridgeServer.URL, HTTP: bridgeServer.Client()}
	cache := &preparationCache{paths: map[string][]string{source + "[]false": {source}}}
	_, err := transport.Call(context.Background(), "workspace", ModelTask{URL: gateway.URL, Source: source, Mime: "application/pdf", MaximumResponseBytes: 1024}, dir, cache, bridge)
	if err == nil || !strings.Contains(err.Error(), "exceeds limit") {
		t.Fatalf("expected limit failure, got %v", err)
	}
	transport.releaseResponse(cache)
	if transport.Responses.Used() != 0 {
		t.Fatal("response credit leaked")
	}
}

// writePages builds a PDF whose page i is 100+i points wide, so output order is visible.
func writePages(t *testing.T, count int) string {
	t.Helper()
	var document bytes.Buffer
	document.WriteString("%PDF-1.7\n")
	var offsets []int
	object := func(body string) {
		offsets = append(offsets, document.Len())
		fmt.Fprintf(&document, "%d 0 obj\n%s\nendobj\n", len(offsets), body)
	}
	kids := ""
	for i := 0; i < count; i++ {
		kids += fmt.Sprintf("%d 0 R ", 3+i)
	}
	object("<< /Type /Catalog /Pages 2 0 R >>")
	object(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids, count))
	for i := 0; i < count; i++ {
		object(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d 100] >>", 100+i))
	}
	xref := document.Len()
	fmt.Fprintf(&document, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&document, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&document, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	path := filepath.Join(t.TempDir(), "pages.pdf")
	if err := os.WriteFile(path, document.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLongDocumentsRenderInOrderedParallelChunks(t *testing.T) {
	worker, err := filepath.Abs("../../bin/document-extraction-pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(worker); err != nil {
		t.Skip("run bun run build:go to build the PDFium worker")
	}
	renderer := pdf.New([]string{worker, "render"}, nil, 3, true)
	defer renderer.Close()
	recorder := &countingBridge{}
	bridgeServer := recorder.server(t)
	transport := NewTransport(nil, renderer, 4, 1<<30, 64<<20)
	bridge := &Bridge{URL: bridgeServer.URL, HTTP: bridgeServer.Client()}
	const pages = 21
	source := writePages(t, pages)
	dir := t.TempDir()
	cache := &preparationCache{paths: map[string][]string{}}
	parts, err := transport.prepare(context.Background(), ModelTask{Source: source, Render: true, PageCount: pages}, dir, cache, bridge)
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != pages {
		t.Fatalf("rendered %d pages", len(parts))
	}
	for i, part := range parts {
		file, err := os.Open(part.path)
		if err != nil {
			t.Fatal(err)
		}
		config, err := png.DecodeConfig(file)
		file.Close()
		if err != nil {
			t.Fatal(err)
		}
		if config.Width != 2*(100+i) {
			t.Fatalf("part %d has width %d: chunks out of order", i, config.Width)
		}
	}
	if renderer.Operations.Load() != 3 {
		t.Fatalf("expected 3 chunk operations, got %d", renderer.Operations.Load())
	}
	if err := transport.clearPreparation(dir, cache); err != nil {
		t.Fatal(err)
	}
	if transport.Artifacts.Used() != 0 {
		t.Fatal("artifact credit leaked")
	}
}
