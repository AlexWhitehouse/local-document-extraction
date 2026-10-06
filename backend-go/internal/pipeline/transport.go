package pipeline

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"document-extraction.local/backend/internal/pdf"
)

type ModelTask struct {
	Final                bool   `json:"-"`
	CacheID              string `json:"cache_id"`
	Continuation         bool   `json:"-"`
	Done                 bool   `json:"done"`
	URL                  string `json:"url"`
	Credential           string `json:"credential"`
	Prefix               string `json:"prefix"`
	Suffix               string `json:"suffix"`
	Source               string `json:"source"`
	Mime                 string `json:"mime"`
	Render               bool   `json:"render"`
	Sequential           bool   `json:"sequential"`
	Pages                []int  `json:"pages"`
	PageCount            int    `json:"page_count"`
	TimeoutMS            int    `json:"timeout_ms"`
	MaximumResponseBytes int64  `json:"maximum_response_bytes"`
}

// Accounting needs these envelope fields, never the potentially large extraction
// content. Preserve their JSON representation for the existing usage validator.
type usageEnvelope struct {
	ID            json.RawMessage `json:"id,omitempty"`
	Usage         json.RawMessage `json:"usage,omitempty"`
	CostBreakdown json.RawMessage `json:"cost_breakdown,omitempty"`
	Currency      json.RawMessage `json:"currency,omitempty"`
}

type GatewayFailure struct {
	Message      string `json:"message"`
	Retryable    bool   `json:"retryable"`
	RetryAfterMS int64  `json:"retry_after_ms"`
	Status       int    `json:"status"`
	Code         string `json:"code,omitempty"`
}

func (e *GatewayFailure) Error() string { return e.Message }

type Transport struct {
	pages      *pageCache
	Responses  *byteBudget
	Artifacts  *byteBudget
	HTTP       *http.Client
	PDF        *pdf.Pool
	Renderer   *pdf.Pool
	slots      chan struct{}
	uploads    chan struct{}
	InFlight   atomic.Int64
	Uploading  atomic.Int64
	mu         sync.Mutex
	sequential map[string]*workspaceTurn
}
type workspaceTurn struct {
	slot chan struct{}
	refs int
}

func NewTransport(pool, renderer *pdf.Pool, capacity int, artifactBytes, responseBytes int64) *Transport {
	return &Transport{Responses: newByteBudget(responseBytes), Artifacts: newByteBudget(artifactBytes), PDF: pool, Renderer: renderer, slots: make(chan struct{}, capacity), uploads: make(chan struct{}, max(1, runtime.GOMAXPROCS(0)*2)), sequential: make(map[string]*workspaceTurn), HTTP: &http.Client{
		Transport:     &http.Transport{ForceAttemptHTTP2: true, HTTP2: &http.HTTP2Config{MaxReceiveBufferPerStream: 256 << 10, MaxReceiveBufferPerConnection: (4 << 20) - 1}, MaxIdleConns: capacity * 2, MaxIdleConnsPerHost: capacity, MaxConnsPerHost: capacity, IdleConnTimeout: 90 * time.Second, ResponseHeaderTimeout: 300 * time.Second},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// turn serializes provider calls for Workspaces that require it. Only waiting
// for another call's turn releases the local permit.
func (t *Transport) turn(ctx context.Context, workspace string, b *Bridge) (func(), error) {
	t.mu.Lock()
	turn := t.sequential[workspace]
	if turn == nil {
		turn = &workspaceTurn{slot: make(chan struct{}, 1)}
		t.sequential[workspace] = turn
	}
	turn.refs++
	t.mu.Unlock()
	releaseRef := func() {
		t.mu.Lock()
		turn.refs--
		if turn.refs == 0 {
			delete(t.sequential, workspace)
		}
		t.mu.Unlock()
	}
	err := b.Wait(ctx, func() bool {
		select {
		case turn.slot <- struct{}{}:
			return true
		default:
			return false
		}
	}, func() error {
		select {
		case turn.slot <- struct{}{}:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	if err != nil {
		releaseRef()
		return nil, err
	}
	return func() { <-turn.slot; releaseRef() }, nil
}

type sourcePart struct {
	path, prefix, suffix string
	size                 int64
}

func partsFor(paths []string, mime string) ([]sourcePart, error) {
	parts := make([]sourcePart, 0, len(paths))
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("source is not a regular file")
		}
		prefix := `{"type":"image_url","image_url":{"url":"data:` + mime + `;base64,`
		suffix := `"}}`
		if mime == "application/pdf" {
			prefix = `{"type":"file","file":{"file_data":"data:application/pdf;base64,`
			suffix = `","format":"application/pdf"}}`
		}
		parts = append(parts, sourcePart{path, prefix, suffix, info.Size()})
	}
	return parts, nil
}

func streamBody(ctx context.Context, task ModelTask, parts []sourcePart) (io.ReadCloser, int64) {
	reader, writer := io.Pipe()
	length := int64(len(task.Prefix) + len(task.Suffix))
	for i, p := range parts {
		length += int64(len(p.prefix)+len(p.suffix)) + ((p.size+2)/3)*4
		if i > 0 {
			length++
		}
	}
	go func() {
		err := writeBody(writer, task, parts)
		writer.CloseWithError(err)
	}()
	return reader, length
}

func writeBody(destination io.Writer, task ModelTask, parts []sourcePart) error {
	out := bufio.NewWriterSize(destination, 64<<10)
	if _, err := io.WriteString(out, task.Prefix); err != nil {
		return err
	}
	for i, p := range parts {
		if i > 0 {
			if _, err := io.WriteString(out, ","); err != nil {
				return err
			}
		}
		if _, err := io.WriteString(out, p.prefix); err != nil {
			return err
		}
		f, err := os.Open(p.path)
		if err != nil {
			return err
		}
		encoder := base64.NewEncoder(base64.StdEncoding, out)
		_, err = io.CopyN(encoder, f, p.size)
		closeErr := encoder.Close()
		f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if _, err = io.WriteString(out, p.suffix); err != nil {
			return err
		}
	}
	_, err := io.WriteString(out, task.Suffix)
	if err != nil {
		return err
	}
	return out.Flush()
}

// Cache only the current representation. Before reserving a different one,
// discard the previous stage's artifacts so upgrades cannot deadlock the budget.
func (t *Transport) clearPreparation(dir string, cache *preparationCache) error {
	t.releaseSharedPages(cache)
	if cache.bytes == 0 {
		clear(cache.paths)
		return nil
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "artifact-") {
			if err := os.Remove(filepath.Join(dir, file.Name())); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	t.Artifacts.release(cache.bytes)
	cache.bytes = 0
	clear(cache.paths)
	return nil
}

// PDF pools already own their CPU/RSS allowance. A document waiting for a pool
// slot releases its local permit; a document that gets one at once keeps it.
func runPDF(ctx context.Context, b *Bridge, pool *pdf.Pool, source, dir string, metadata any, continuation bool, reserve func() error) ([]string, error) {
	var release func()
	err := b.Wait(ctx, func() bool {
		var ok bool
		release, ok = pool.TryAdmit()
		return ok
	}, func() error {
		var err error
		release, err = pool.Admit(ctx, continuation)
		return err
	})
	if err != nil {
		return nil, err
	}
	defer release()
	return pool.RunAdmitted(ctx, source, dir, metadata, reserve)
}

func (t *Transport) reserveArtifacts(ctx context.Context, b *Bridge, bytes int64) error {
	return b.Wait(ctx, func() bool { return t.Artifacts.tryAcquire(bytes) }, func() error { return t.Artifacts.acquire(ctx, bytes) })
}

// Pages beyond one chunk render in parallel processes, so a long document is
// not serialized on one worker. Each chunk reloads the source.
const renderChunkPages = 8

func (t *Transport) prepare(ctx context.Context, task ModelTask, dir string, cache *preparationCache, b *Bridge) (parts []sourcePart, err error) {
	key := task.Source + fmt.Sprint(task.Pages) + strconv.FormatBool(task.Render)
	paths := cache.paths[key]
	mime := task.Mime
	if task.Render {
		mime = "image/png"
	}
	if paths != nil {
		return partsFor(paths, mime)
	}
	if err = t.clearPreparation(dir, cache); err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = t.clearPreparation(dir, cache)
		}
	}()
	keys, err := pageKeys(task)
	if err != nil {
		return nil, err
	}
	if t.pages != nil && len(keys) > 0 {
		var reused []string
		var actual int64
		// Reserve before linking cache artifacts. Waiting releases local capacity.
		if err = t.reserveArtifacts(ctx, b, 64<<20); err != nil {
			return nil, err
		}
		cache.bytes += 64 << 20
		reused, actual, err = t.pages.lookup(keys, dir)
		if err != nil {
			return nil, err
		}
		if reused != nil {
			if actual > 64<<20 {
				return nil, pdf.ErrArtifactLimit
			}
			t.Artifacts.release((64 << 20) - actual)
			cache.bytes -= (64 << 20) - actual
			cache.paths[key] = reused
			if task.Continuation {
				cache.sharedKeys = keys
			}
			return partsFor(reused, mime)
		}
		t.Artifacts.release(64 << 20)
		cache.bytes -= 64 << 20
	}
	// A subset can occupy 32 MiB and rendered pages at most 64 MiB.
	reservation := int64(0)
	if len(task.Pages) > 0 && !task.Render {
		reservation += 32 << 20
	}
	if task.Render {
		reservation += 64 << 20
	}
	var reserveMu sync.Mutex
	reserved := false
	reserve := func() error {
		reserveMu.Lock()
		defer reserveMu.Unlock()
		if reserved {
			return nil
		}
		if err := t.reserveArtifacts(ctx, b, reservation); err != nil {
			return err
		}
		reserved = true
		cache.bytes += reservation
		return nil
	}
	generated := []string{}
	source := task.Source
	if len(task.Pages) > 0 && !task.Render {
		selected, err := runPDF(ctx, b, t.PDF, source, dir, map[string]any{"operation": "materialize", "groups": [][]int{task.Pages}}, task.Continuation, reserve)
		if err != nil {
			return nil, err
		}
		if len(selected) != 1 {
			return nil, errors.New("PDF subset missing")
		}
		source = selected[0]
		generated = append(generated, selected...)
	}
	paths = []string{source}
	if task.Render {
		rendered, err := t.render(ctx, b, source, dir, task, false, reserve)
		if errors.Is(err, pdf.ErrArtifactLimit) && ctx.Err() == nil {
			// Maximum DEFLATE effort keeps pages within the payload limit when
			// fast compression alone does not.
			rendered, err = t.render(ctx, b, source, dir, task, true, reserve)
		}
		if err != nil {
			return nil, err
		}
		paths = rendered
		generated = append(generated, rendered...)
	}
	var actual int64
	for _, path := range generated {
		info, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		actual += info.Size()
	}
	if actual > reservation {
		return nil, pdf.ErrArtifactLimit
	}
	t.Artifacts.release(reservation - actual)
	cache.bytes -= reservation - actual
	cache.paths[key] = paths
	if t.pages != nil && len(keys) > 0 && !task.Continuation {
		t.pages.put(keys, paths)
		cache.published = make(map[int]string)
		for i, page := range task.Pages {
			cache.published[page] = keys[i]
		}
	}
	return partsFor(paths, mime)
}

func (t *Transport) render(ctx context.Context, b *Bridge, source, dir string, task ModelTask, best bool, reserve func() error) ([]string, error) {
	pages := task.Pages
	if len(pages) == 0 && task.PageCount > renderChunkPages {
		pages = make([]int, task.PageCount)
		for i := range pages {
			pages[i] = i + 1
		}
	}
	chunks := [][]int{pages}
	if len(pages) > renderChunkPages {
		chunks = nil
		for start := 0; start < len(pages); start += renderChunkPages {
			chunks = append(chunks, pages[start:min(start+renderChunkPages, len(pages))])
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make([][]string, len(chunks))
	errs := make([]error, len(chunks))
	var wg sync.WaitGroup
	for i, chunk := range chunks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			metadata := map[string]any{"operation": "render"}
			if len(chunk) > 0 {
				metadata["pages"] = chunk
			}
			if best {
				metadata["compression"] = "best"
			}
			results[i], errs[i] = runPDF(ctx, b, t.Renderer, source, dir, metadata, task.Continuation, reserve)
			if errs[i] != nil {
				cancel()
			}
		}()
	}
	wg.Wait()
	var paths []string
	for _, result := range results {
		paths = append(paths, result...)
	}
	if err := errors.Join(errs...); err != nil {
		for _, path := range paths {
			_ = os.Remove(path)
		}
		// One chunk's limit cancels its siblings; report the cause, not the cancellation.
		for _, chunkErr := range errs {
			if errors.Is(chunkErr, pdf.ErrArtifactLimit) {
				return nil, pdf.ErrArtifactLimit
			}
		}
		for _, chunkErr := range errs {
			if chunkErr != nil && !errors.Is(chunkErr, context.Canceled) {
				return nil, chunkErr
			}
		}
		return nil, err
	}
	if len(paths) == 0 {
		return nil, errors.New("PDF rendered no pages")
	}
	return paths, nil
}

func (t *Transport) releaseResponse(cache *preparationCache) {
	t.Responses.release(cache.responseBytes)
	cache.responseBytes = 0
}

func (t *Transport) Call(ctx context.Context, workspace string, task ModelTask, dir string, cache *preparationCache, b *Bridge) (json.RawMessage, error) {
	if task.CacheID != "" {
		task.CacheID = workspace + "/" + task.CacheID
	}
	parts, err := t.prepare(ctx, task, dir, cache, b)
	if err != nil {
		return nil, err
	}
	// Sequential Workspaces serialize provider calls, not local preparation.
	if task.Sequential {
		release, err := t.turn(ctx, workspace, b)
		if err != nil {
			return nil, err
		}
		defer release()
	}
	err = b.Wait(ctx, func() bool {
		select {
		case t.slots <- struct{}{}:
			return true
		default:
			return false
		}
	}, func() error {
		select {
		case t.slots <- struct{}{}:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	if err != nil {
		return nil, err
	}
	t.InFlight.Add(1)
	defer t.InFlight.Add(-1)
	defer func() { <-t.slots }()
	receiptID, err := b.StartCall(ctx)
	if err != nil {
		return nil, err
	}
	var body json.RawMessage
	var accounting usageEnvelope
	headers := map[string]string{}
	successful := false
	status := 0
	defer func() {
		if successful {
			cache.receipt = map[string]any{"id": receiptID, "body": accounting, "headers": headers}
			return
		}
		finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		// A failed accounting callback must not turn a successful model result into
		// another paid call. The durable pending receipt remains explicitly unknown.
		_ = b.Call(finishCtx, "call/finish", map[string]any{"id": receiptID, "body": accounting, "headers": headers, "success": successful, "status": status}, nil)
	}()
	timeout := time.Duration(task.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	select {
	case t.uploads <- struct{}{}:
	case <-callCtx.Done():
		return nil, callCtx.Err()
	}
	t.Uploading.Add(1)
	var uploaded sync.Once
	releaseUpload := func() { uploaded.Do(func() { <-t.uploads; t.Uploading.Add(-1) }) }
	defer releaseUpload()
	var releasedPreparation sync.Once
	releasePreparation := func() {
		if task.Final {
			releasedPreparation.Do(func() { _ = t.clearPreparation(dir, cache) })
		}
	}
	defer releasePreparation()
	callCtx = httptrace.WithClientTrace(callCtx, &httptrace.ClientTrace{WroteRequest: func(info httptrace.WroteRequestInfo) {
		releaseUpload()
		if info.Err == nil {
			releasePreparation()
		}
	}})
	stream, length := streamBody(callCtx, task, parts)
	defer stream.Close()
	req, err := http.NewRequestWithContext(callCtx, http.MethodPost, task.URL, stream)
	if err != nil {
		return nil, err
	}
	req.ContentLength = length
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+task.Credential)
	response, err := t.HTTP.Do(req)
	// Once also joins an in-progress trace callback before response processing
	// or a retry can touch the run cache. Durable sources are never removed here.
	releasePreparation()
	releaseUpload()
	if response != nil {
		defer response.Body.Close()
	}
	// Read and normalize bodies only with local capacity. TCP backpressure keeps
	// a simultaneous burst of provider responses from becoming unbounded RAM.
	if resumeErr := b.Resume(ctx); resumeErr != nil {
		return nil, resumeErr
	}
	if err != nil {
		return nil, &GatewayFailure{Message: "Model gateway request failed or timed out", Retryable: true}
	}
	status = response.StatusCode
	for _, name := range []string{"x-request-id", "x-requesty-request-id", "x-litellm-call-id", "x-litellm-response-cost"} {
		if value := response.Header.Get(name); value != "" {
			headers[name] = value
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &GatewayFailure{Message: fmt.Sprintf("Model gateway request failed with HTTP %d", response.StatusCode), Retryable: response.StatusCode == 408 || response.StatusCode == 429 || response.StatusCode >= 500, RetryAfterMS: retryAfter(response.Header.Get("Retry-After")), Status: response.StatusCode}
	}
	limit := task.MaximumResponseBytes
	if limit <= 0 {
		limit = 32 << 20
	}
	body, err = t.readResponse(ctx, b, response, limit, cache)
	if err != nil {
		return nil, err
	}
	if json.Unmarshal(body, &accounting) != nil {
		body = nil
		accounting = usageEnvelope{}
		return nil, &GatewayFailure{Message: "Model gateway returned invalid JSON", Retryable: true}
	}
	successful = true
	return body, nil
}

// Response credit starts at the known length, or one chunk when unknown, and
// grows as bytes arrive. Unknown-length bodies no longer reserve the whole limit.
const responseChunk = 1 << 20

func (t *Transport) readResponse(ctx context.Context, b *Bridge, response *http.Response, limit int64, cache *preparationCache) ([]byte, error) {
	held := int64(0)
	grow := func(bytes int64) error {
		if !t.Responses.tryAcquire(bytes) {
			if err := b.Suspend(ctx); err != nil {
				return err
			}
			if err := t.Responses.acquire(ctx, bytes); err != nil {
				return err
			}
			if err := b.Resume(ctx); err != nil {
				t.Responses.release(bytes)
				return err
			}
		}
		// Keep the credit through normalization and the durable adapter commit.
		held += bytes
		cache.responseBytes += bytes
		return nil
	}
	initial := min(limit+1, responseChunk)
	if response.ContentLength >= 0 {
		initial = min(limit+1, response.ContentLength)
	}
	if err := grow(initial); err != nil {
		return nil, err
	}
	body := make([]byte, 0, initial)
	for {
		if int64(len(body)) > limit {
			return nil, &GatewayFailure{Message: "Model gateway response exceeds limit"}
		}
		var n int
		var err error
		if int64(len(body)) < held {
			n, err = response.Body.Read(body[len(body):held])
			body = body[:len(body)+n]
		} else {
			// Probe before growing, so an exact Content-Length needs no extra credit.
			var probe [1]byte
			if n, err = response.Body.Read(probe[:]); n > 0 {
				if growErr := grow(min(max(held, responseChunk), limit+1-held)); growErr != nil {
					return nil, growErr
				}
				body = append(slices.Grow(body, int(held)-len(body)), probe[0])
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, &GatewayFailure{Message: "Model gateway response interrupted", Retryable: true}
		}
	}
	if int64(len(body)) > limit {
		return nil, &GatewayFailure{Message: "Model gateway response exceeds limit"}
	}
	unused := held - int64(len(body))
	t.Responses.release(unused)
	cache.responseBytes -= unused
	return body, nil
}

func retryAfter(value string) int64 {
	seconds, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err == nil && seconds >= 0 && seconds <= 86400*365 {
		return seconds * 1000
	}
	if deadline, err := http.ParseTime(value); err == nil {
		return max(0, time.Until(deadline).Milliseconds())
	}
	return 0
}

func (t *Transport) releaseSharedPages(cache *preparationCache) {
	if t.pages == nil {
		return
	}
	t.pages.remove(cache.sharedKeys)
	cache.sharedKeys = nil
	if !cache.handedOff {
		keys := make([]string, 0, len(cache.published))
		for _, key := range cache.published {
			keys = append(keys, key)
		}
		t.pages.remove(keys)
		cache.published = nil
	}
}
