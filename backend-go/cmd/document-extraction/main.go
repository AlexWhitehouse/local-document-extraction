package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"document-extraction.local/backend/internal/pdf"
	"document-extraction.local/backend/internal/pipeline"
)

func positive(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > 4096 {
		log.Fatalf("invalid %s", name)
	}
	return n
}

func workerBinary() string {
	if path := os.Getenv("GO_PDF_WORKER_BINARY"); path != "" {
		return path
	}
	executable, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	return filepath.Join(filepath.Dir(executable), "document-extraction-pdf")
}

func main() {
	os.Setenv("GO_PDF_WORKER_DOCUMENTS", strconv.Itoa(positive("GO_PDF_WORKER_DOCUMENTS", 128)))
	token := os.Getenv("GO_PROCESSOR_TOKEN")
	if len(token) < 32 {
		log.Fatal("GO_PROCESSOR_TOKEN must contain at least 32 characters")
	}
	// Subset PDFs still use the product's pdf-lib workers; rendering uses PDFium.
	pool := pdf.New([]string{os.Getenv("GO_PROCESSOR_BUN"), "--no-env-file", os.Getenv("GO_PROCESSOR_PDF_SCRIPT")}, []string{"GO_PDF_FILE_INPUT=1"}, positive("GO_PDF_PREPARATION_WORKERS", 4), false)
	renderer := pdf.New([]string{workerBinary(), "render"}, nil, positive("GO_PDF_WORKERS", runtime.GOMAXPROCS(0)), true)
	artifactMiB := positive("GO_PREPARED_ARTIFACT_MIB", 1024)
	if artifactMiB < 96 {
		log.Fatal("GO_PREPARED_ARTIFACT_MIB must be at least 96")
	}
	responseMiB := positive("GO_RESPONSE_BUFFER_MIB", 512)
	if responseMiB < 64 {
		log.Fatal("GO_RESPONSE_BUFFER_MIB must be at least 64")
	}
	cacheMiB := min(512, artifactMiB/3)
	cacheDirectory := os.Getenv("GO_PROCESSOR_PAGE_CACHE")
	if cacheDirectory == "" {
		cacheMiB = 0
	}
	engine := &pipeline.Engine{Transport: pipeline.NewTransport(pool, renderer, positive("GO_MODEL_CONCURRENCY", 24), int64(artifactMiB-cacheMiB)<<20, int64(responseMiB)<<20)}
	if cacheMiB > 0 {
		engine.Transport.EnablePageCache(cacheDirectory, int64(cacheMiB)<<20)
		defer os.RemoveAll(cacheDirectory)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /run", func(w http.ResponseWriter, r *http.Request) {
		var input pipeline.RunRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
			http.Error(w, "Invalid task", 400)
			return
		}
		if err := engine.Run(r.Context(), input); err != nil {
			http.Error(w, "Processing interrupted", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"renderer": renderer.Stats(), "page_cache": engine.Transport.PageCacheStats(), "render_operations": renderer.Operations.Load(), "materialize_operations": pool.Operations.Load(), "response_buffer_bytes": engine.Transport.Responses.Used(), "prepared_artifact_bytes": engine.Transport.Artifacts.Used(), "model_in_flight": engine.Transport.InFlight.Load(), "uploading": engine.Transport.Uploading.Load(), "pid": os.Getpid(), "active": engine.Active.Load(), "completed": engine.Completed.Load(), "failed": engine.Failed.Load(), "pdf_operations": pool.Operations.Load() + renderer.Operations.Load(), "pdf_process_starts": pool.Starts.Load() + renderer.Starts.Load()})
	})
	root, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case now := <-ticker.C:
				engine.Transport.PrunePages(now)
			case <-root.Done():
				return
			}
		}
	}()
	server := &http.Server{BaseContext: func(net.Listener) context.Context { return root }, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "Unauthorized", 401)
			return
		}
		mux.ServeHTTP(w, r)
	})}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("GO_PROCESSOR_READY %s\n", listener.Addr())
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Print(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		select {
		case stop <- syscall.SIGTERM:
		default:
		}
	}()
	<-stop
	cancelRoot()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		server.Close()
	}
	pool.Close()
	renderer.Close()
}
