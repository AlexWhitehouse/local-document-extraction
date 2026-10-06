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
	"sync/atomic"
	"time"
)

var adapterHTTP = &http.Client{Transport: &http.Transport{
	MaxIdleConns: 128, MaxIdleConnsPerHost: 128, IdleConnTimeout: 90 * time.Second,
}}

type Bridge struct {
	URL, Token string
	HTTP       *http.Client
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

// Wait releases local processing capacity without releasing durable job ownership.
func (b *Bridge) Wait(ctx context.Context, wait func() error) error {
	if err := b.Call(ctx, "capacity/suspend", nil, nil); err != nil {
		return err
	}
	err := wait()
	if resumeErr := b.Call(ctx, "capacity/resume", nil, nil); resumeErr != nil {
		return resumeErr
	}
	return err
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
type state struct {
	Done     bool `json:"done"`
	Packet   bool `json:"packet"`
	Bound    bool `json:"bound"`
	Accepted bool `json:"accepted"`
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
		var current state
		if err := bridge.Call(ctx, "state", nil, &current); err != nil {
			return err
		}
		if current.Done {
			e.Completed.Add(1)
			return nil
		}
		stage := "extract"
		if current.Packet {
			if current.Accepted {
				if err := e.materialize(ctx, bridge, input, cache); err != nil {
					return e.fail(ctx, bridge, "materialize", err)
				}
				e.Completed.Add(1)
				return nil
			}
			stage = "split"
		} else if !current.Bound {
			stage = "route"
		}
		var task ModelTask
		if err := bridge.Call(ctx, stage+"/claim", nil, &task); err != nil {
			return e.fail(ctx, bridge, stage, err)
		}
		if task.Done {
			return nil
		}
		task.Continuation = !current.Packet
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
			if err := bridge.Wait(ctx, func() error {
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

func (e *Engine) materialize(ctx context.Context, b *Bridge, input RunRequest, cache *preparationCache) error {
	var task struct {
		Source  string  `json:"source"`
		Groups  [][]int `json:"groups"`
		Virtual bool    `json:"virtual"`
	}
	if err := b.Call(ctx, "materialize/claim", nil, &task); err != nil {
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
			if err := e.Transport.Artifacts.acquire(ctx, 64<<20); err != nil {
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
