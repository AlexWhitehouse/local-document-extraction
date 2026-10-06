package pipeline

import (
	"context"
	"errors"
	"sync"
)

// byteBudget reserves the worst case before PDF work, then refunds unused bytes.
// Waiters are granted in FIFO order; tryAcquire never overtakes a waiter.
type byteBudget struct {
	mu          sync.Mutex
	limit, used int64
	waiters     []*budgetWaiter
}

type budgetWaiter struct {
	bytes   int64
	ready   chan struct{}
	granted bool
}

func newByteBudget(limit int64) *byteBudget {
	return &byteBudget{limit: limit}
}

func (b *byteBudget) tryAcquire(bytes int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if bytes < 0 || len(b.waiters) > 0 || b.used+bytes > b.limit {
		return false
	}
	b.used += bytes
	return true
}

func (b *byteBudget) acquire(ctx context.Context, bytes int64) error {
	if bytes < 0 || bytes > b.limit {
		return errors.New("artifact exceeds byte budget")
	}
	b.mu.Lock()
	if len(b.waiters) == 0 && b.used+bytes <= b.limit {
		b.used += bytes
		b.mu.Unlock()
		return nil
	}
	waiter := &budgetWaiter{bytes: bytes, ready: make(chan struct{})}
	b.waiters = append(b.waiters, waiter)
	b.mu.Unlock()
	select {
	case <-waiter.ready:
		return nil
	case <-ctx.Done():
		b.mu.Lock()
		defer b.mu.Unlock()
		if waiter.granted {
			b.used -= bytes
		} else {
			for i, candidate := range b.waiters {
				if candidate == waiter {
					b.waiters = append(b.waiters[:i], b.waiters[i+1:]...)
					break
				}
			}
		}
		b.grantLocked()
		return ctx.Err()
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
	b.grantLocked()
}

func (b *byteBudget) grantLocked() {
	for len(b.waiters) > 0 && b.used+b.waiters[0].bytes <= b.limit {
		waiter := b.waiters[0]
		b.waiters = b.waiters[1:]
		b.used += waiter.bytes
		waiter.granted = true
		close(waiter.ready)
	}
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
