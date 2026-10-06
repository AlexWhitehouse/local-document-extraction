package pipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

var adapterHTTP = &http.Client{Transport: &http.Transport{
	MaxIdleConns: 128, MaxIdleConnsPerHost: 128, IdleConnTimeout: 90 * time.Second,
}}

type Bridge struct {
	URL, Token string
	HTTP       *http.Client
	mu         sync.Mutex
	suspended  bool
}

func (b *Bridge) Call(ctx context.Context, operation string, input, output any) error {
	data, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.URL+"/"+operation, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+b.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := b.HTTP.Do(req)
	if err != nil {
		return errors.New("durable adapter unavailable")
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return err
	}
	if res.StatusCode != 200 {
		var failure GatewayFailure
		if json.Unmarshal(body, &failure) == nil && failure.Message != "" {
			return &failure
		}
		return fmt.Errorf("durable adapter rejected operation %s (%d)", operation, res.StatusCode)
	}
	if output != nil {
		return json.Unmarshal(body, output)
	}
	return nil
}

// Suspend releases the job's local processing permit while keeping durable job
// ownership. The permit stays released until Resume; repeated calls are free.
func (b *Bridge) Suspend(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.suspended {
		return nil
	}
	if err := b.Call(ctx, "capacity/suspend", nil, nil); err != nil {
		return err
	}
	b.suspended = true
	return nil
}

// Resume waits for a local permit; returning responses take priority over new work.
func (b *Bridge) Resume(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.suspended {
		return nil
	}
	if err := b.Call(ctx, "capacity/resume", nil, nil); err != nil {
		return err
	}
	b.suspended = false
	return nil
}

// Wait runs wait without a local permit unless try obtains the resource at once.
func (b *Bridge) Wait(ctx context.Context, try func() bool, wait func() error) error {
	if try != nil && try() {
		return nil
	}
	if err := b.Suspend(ctx); err != nil {
		return err
	}
	return wait()
}

// StartCall records the pending usage receipt; the adapter also releases the
// local permit for the provider wait, saving a separate suspension round trip.
func (b *Bridge) StartCall(ctx context.Context) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	var receipt struct {
		ID string `json:"id"`
	}
	if err := b.Call(ctx, "call/start", nil, &receipt); err != nil {
		return "", err
	}
	b.suspended = true
	return receipt.ID, nil
}

type RunRequest struct {
	Bridge    string `json:"bridge"`
	Token     string `json:"token"`
	Workspace string `json:"workspace"`
	Directory string `json:"directory"`
}

type Engine struct {
	Transport *Transport
	Active    atomic.Int64
	Completed atomic.Uint64
	Failed    atomic.Uint64
}

// step is the adapter's next stage together with its durable claim.
type step struct {
	Stage string          `json:"stage"`
	Task  json.RawMessage `json:"task"`
}

func (e *Engine) Run(ctx context.Context, input RunRequest) error {
	e.Active.Add(1)

	defer e.Active.Add(-1)
	bridge := &Bridge{URL: input.Bridge, Token: input.Token, HTTP: adapterHTTP}
	cache := &preparationCache{paths: make(map[string][]string)}
	defer func() {
		e.Transport.releaseResponse(cache)
		e.Transport.releaseSharedPages(cache)
		os.RemoveAll(input.Directory)
		e.Transport.Artifacts.release(cache.bytes)
	}()
	for {
		var next step
		if err := bridge.Call(ctx, "next", nil, &next); err != nil {
			return e.fail(ctx, bridge, "", err)
		}
		if next.Stage == "done" {
			e.Completed.Add(1)
			return nil
		}
		if next.Stage == "materialize" {
			if err := e.materialize(ctx, bridge, input, cache, next.Task); err != nil {
				return e.fail(ctx, bridge, "materialize", err)
			}
			e.Completed.Add(1)
			return nil
		}
		stage := next.Stage
		if stage != "split" && stage != "route" && stage != "extract" {
			return errors.New("unknown processing stage")
		}
		var task ModelTask
		if err := json.Unmarshal(next.Task, &task); err != nil {
			return e.fail(ctx, bridge, stage, err)
		}
		if task.Done {
			return nil
		}
		task.Continuation = stage != "split"
		task.Final = stage == "extract"
		tries := 1
		if stage != "extract" {
			tries = 3
		}
		var result json.RawMessage
		var err error
		for attempt := 0; attempt < tries; attempt++ {
			result, err = e.Transport.Call(ctx, input.Workspace, task, input.Directory, cache, bridge)
			if err == nil {
				err = bridge.Call(ctx, stage+"/complete-with-usage", map[string]any{"result": result, "receipt": cache.receipt}, nil)
				cache.receipt = nil
			}
			e.Transport.releaseResponse(cache)
			result = nil
			if err == nil {
				break
			}
			var failure *GatewayFailure
			if !errors.As(err, &failure) || !failure.Retryable || attempt+1 >= tries {
				break
			}
			delay := max(time.Duration(250*(1<<attempt))*time.Millisecond, time.Duration(failure.RetryAfterMS)*time.Millisecond)
			if delay > 60*time.Second {
				break
			}
			if err := bridge.Wait(ctx, nil, func() error {
				timer := time.NewTimer(delay)
				defer timer.Stop()
				select {
				case <-timer.C:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			}); err != nil {
				return err
			}
		}
		if err != nil {
			return e.fail(ctx, bridge, stage, err)
		}
		if stage == "extract" {
			e.Completed.Add(1)
			return nil
		}
	}
}

func (e *Engine) fail(ctx context.Context, b *Bridge, stage string, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	failure := &GatewayFailure{Message: "Document processing failed"}
	var typed *GatewayFailure
	if errors.As(err, &typed) {
		failure = typed
	}
	e.Failed.Add(1)
	return b.Call(ctx, "failure", map[string]any{"stage": stage, "failure": failure}, nil)
}

func (e *Engine) materialize(ctx context.Context, b *Bridge, input RunRequest, cache *preparationCache, claim json.RawMessage) error {
	var task struct {
		Source  string  `json:"source"`
		Groups  [][]int `json:"groups"`
		Virtual bool    `json:"virtual"`
	}
	if err := json.Unmarshal(claim, &task); err != nil {
		return err
	}
	if task.Virtual {
		if err := b.Call(ctx, "materialize/complete", map[string]any{}, nil); err != nil {
			return err
		}
		keep := make(map[int]bool)
		for _, group := range task.Groups {
			for _, page := range group {
				keep[page] = true
			}
		}
		var excluded []string
		for page, key := range cache.published {
			if !keep[page] {
				excluded = append(excluded, key)
			}
		}
		if e.Transport.pages != nil {
			e.Transport.pages.remove(excluded)
		}
		cache.handedOff = true
		return nil
	}
	if err := e.Transport.clearPreparation(input.Directory, cache); err != nil {
		return err
	}
	artifacts := []string{}
	if len(task.Groups) > 0 {
		reserve := func() error {
			if err := e.Transport.reserveArtifacts(ctx, b, 64<<20); err != nil {
				return err
			}
			cache.bytes += 64 << 20
			return nil
		}
		paths, err := runPDF(ctx, b, e.Transport.PDF, task.Source, input.Directory, map[string]any{"operation": "materialize", "groups": task.Groups}, true, reserve)
		if err != nil {
			return err
		}
		if len(paths) != len(task.Groups) {
			return errors.New("PDF child count mismatch")
		}
		for _, path := range paths {
			artifacts = append(artifacts, filepath.Base(path))
		}
	}
	return b.Call(ctx, "materialize/complete", map[string]any{"artifacts": artifacts}, nil)
}
