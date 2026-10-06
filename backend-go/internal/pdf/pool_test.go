package pdf

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWarmWorkerSurvivesCompletedOperationCancellation(t *testing.T) {
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("Bun is required for PDF integration")
	}
	backend, err := filepath.Abs("../../../backend")
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "fixture.pdf")
	generate := exec.Command(bun, "--no-env-file", "-e", `import {PDFDocument} from "pdf-lib";const doc=await PDFDocument.create();doc.addPage([100,100]);await Bun.write(process.env.PDF_TEST_FILE,await doc.save());`)
	generate.Dir = backend
	generate.Env = append(os.Environ(), "PDF_TEST_FILE="+source)
	if output, err := generate.CombinedOutput(); err != nil {
		t.Fatalf("fixture: %v: %s", err, output)
	}
	pool := New(pdfiumWorker(t), nil, 2, true)
	defer pool.Close()
	for i := 0; i < 40; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		paths, err := pool.Run(ctx, source, t.TempDir(), map[string]string{"operation": "render"})
		cancel()
		if err != nil {
			t.Fatalf("operation %d: %v", i, err)
		}
		if len(paths) != 1 {
			t.Fatalf("operation %d returned %d pages", i, len(paths))
		}
	}
	if starts := pool.Starts.Load(); starts > 4 {
		t.Fatalf("warm workers unexpectedly restarted %d times", starts)
	}
}

func TestRejectedPDFRemovesPartialArtifacts(t *testing.T) {
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("Bun is required for PDF integration")
	}
	backend, err := filepath.Abs("../../../backend")
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	source := filepath.Join(directory, "source.pdf")
	script := filepath.Join(directory, "worker.ts")
	code := fmt.Sprintf(`import {createPdfFrameReader} from %q;
const reader=createPdfFrameReader(Bun.stdin.stream());
for(let i=0;i<2;i++){const header=await reader.read(4);await reader.read(new DataView(header.buffer).getUint32(0));}
const output=Buffer.alloc(11);output.writeInt32BE(3);output.write("png",4);output.writeInt32BE(-22,7);await Bun.write(Bun.stdout,output);`, filepath.Join(backend, "src/lib/pdfProcessPool.ts"))
	if err := os.WriteFile(script, []byte(code), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	pool := New([]string{bun, script}, nil, 1, true)
	defer pool.Close()
	artifacts := t.TempDir()
	_, err = pool.Run(context.Background(), source, artifacts, map[string]string{"operation": "render"})
	if !errors.Is(err, ErrArtifactLimit) {
		t.Fatalf("expected artifact limit, got %v", err)
	}
	files, err := os.ReadDir(artifacts)
	if err != nil || len(files) != 0 {
		t.Fatalf("partial files retained: %v %v", files, err)
	}
}

// pdfiumWorker returns the worker built by `bun run build:go`.
func pdfiumWorker(t *testing.T) []string {
	t.Helper()
	worker, err := filepath.Abs("../../bin/document-extraction-pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(worker); err != nil {
		t.Skip("run bun run build:go to build the PDFium worker")
	}
	return []string{worker, "serve"}
}

func TestTryAdmitNeverOvertakesQueuedWork(t *testing.T) {
	pool := New([]string{"unused"}, nil, 1, true)
	defer pool.Close()
	release, ok := pool.TryAdmit()
	if !ok {
		t.Fatal("free slot refused")
	}
	if _, ok := pool.TryAdmit(); ok {
		t.Fatal("full pool admitted")
	}
	admitted := make(chan func(), 1)
	go func() {
		next, err := pool.Admit(context.Background(), false)
		if err != nil {
			t.Error(err)
		}
		admitted <- next
	}()
	for pool.admission.queued() == 0 {
		runtime.Gosched()
	}
	release()
	next := <-admitted
	if _, ok := pool.TryAdmit(); ok {
		t.Fatal("try overtook a granted waiter")
	}
	next()
}

func (a *admission) queued() int { a.mu.Lock(); defer a.mu.Unlock(); return len(a.waiting) }
