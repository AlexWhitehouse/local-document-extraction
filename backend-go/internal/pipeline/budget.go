package pipeline

import (
	"context"
	"errors"
	"sync"
)

// byteBudget reserves the worst case before PDF work, then refunds unused bytes.
// Waiting consumes neither a PDF worker nor a local processing permit.
type byteBudget struct {
	mu          sync.Mutex
	limit, used int64
	changed     chan struct{}
}

func newByteBudget(limit int64) *byteBudget {
	return &byteBudget{limit: limit, changed: make(chan struct{})}
}
func (b *byteBudget) tryAcquire(bytes int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if bytes < 0 || b.used+bytes > b.limit {
		return false
	}
	b.used += bytes
	return true
}

func (b *byteBudget) acquire(ctx context.Context, bytes int64) error {
	if bytes < 0 || bytes > b.limit {
		return errors.New("artifact exceeds byte budget")
	}
	for {
		b.mu.Lock()
		if b.used+bytes <= b.limit {
			b.used += bytes
			b.mu.Unlock()
			return nil
		}
		changed := b.changed
		b.mu.Unlock()
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
func (b *byteBudget) release(bytes int64) {
	if bytes == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.used -= bytes
	if b.used < 0 {
		panic("artifact budget released twice")
	}
	close(b.changed)
	b.changed = make(chan struct{})
}
func (b *byteBudget) Used() int64 { b.mu.Lock(); defer b.mu.Unlock(); return b.used }

type preparationCache struct {
	receipt       map[string]any
	sharedKeys    []string
	published     map[int]string
	handedOff     bool
	responseBytes int64
	paths         map[string][]string
	bytes         int64
}
