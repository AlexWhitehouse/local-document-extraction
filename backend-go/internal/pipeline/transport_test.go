package pipeline

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestStreamingModelBodyPreservesSourceAndLength(t *testing.T) {
	for _, size := range []int{1, 2, 3, 1023, 1024, 65535, 1 << 20} {
		t.Run(strconv.Itoa(size), func(t *testing.T) {
			data := bytes.Repeat([]byte{0, 255, 17, 42}, (size+3)/4)[:size]
			path := filepath.Join(t.TempDir(), "source.pdf")
			if err := os.WriteFile(path, data, 0600); err != nil {
				t.Fatal(err)
			}
			parts, err := partsFor([]string{path}, "application/pdf")
			if err != nil {
				t.Fatal(err)
			}
			task := ModelTask{Prefix: `{"messages":[{"role":"user","content":[{"type":"text","text":"quoted \\\" field"},`, Suffix: `]}]}`}
			stream, length := streamBody(context.Background(), task, parts)
			defer stream.Close()
			body, err := io.ReadAll(stream)
			if err != nil {
				t.Fatal(err)
			}
			if int64(len(body)) != length {
				t.Fatalf("content length %d != %d", len(body), length)
			}
			if !json.Valid(body) {
				t.Fatalf("invalid JSON %s", body[:min(len(body), 200)])
			}
			expected := base64.StdEncoding.EncodeToString(data)
			if !bytes.Contains(body, []byte(expected)) {
				t.Fatal("source bytes changed")
			}
		})
	}
}

func TestClosingStreamingBodyUnblocksProducer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(path, make([]byte, 1<<20), 0600); err != nil {
		t.Fatal(err)
	}
	parts, err := partsFor([]string{path}, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	r, _ := streamBody(context.Background(), ModelTask{Prefix: "[", Suffix: "]"}, parts)
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	// Direct writer failure must propagate; no complete buffered document is needed.
	out := &failingWriter{}
	if err := writeBody(out, ModelTask{}, parts); err == nil {
		t.Fatal("expected canceled consumer error")
	}
}

type failingWriter struct{}

func (*failingWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestRetryAfter(t *testing.T) {
	if retryAfter("12") != 12000 {
		t.Fatal("seconds not honored")
	}
	if retryAfter("-1") != 0 || retryAfter("bogus") != 0 {
		t.Fatal("invalid retry")
	}
	future := time.Now().Add(time.Minute).UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT")
	if delay := retryAfter(future); delay < 58000 || delay > 60000 {
		t.Fatalf("HTTP date %d", delay)
	}
}
