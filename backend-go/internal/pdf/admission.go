package pdf

import (
	"context"
	"sync"
)

type waiter struct {
	ready        chan struct{}
	continuation bool
	granted      bool
}

// Completion work must not sit behind a whole upload backlog. Two continuation
// turns then one new-document turn keeps both ends of the pipeline moving.
type admission struct {
	mu                              sync.Mutex
	capacity, active, continuations int
	waiting                         []*waiter
}

func (a *admission) acquire(ctx context.Context, continuation bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	a.mu.Lock()
	if a.active < a.capacity {
		a.active++
		a.mu.Unlock()
		return nil
	}
	w := &waiter{ready: make(chan struct{}), continuation: continuation}
	a.waiting = append(a.waiting, w)
	a.mu.Unlock()
	select {
	case <-w.ready:
		if err := ctx.Err(); err != nil {
			a.release()
			return err
		}
		return nil
	case <-ctx.Done():
		a.mu.Lock()
		if w.granted {
			a.releaseLocked()
		} else {
			for i, candidate := range a.waiting {
				if candidate == w {
					a.waiting = append(a.waiting[:i], a.waiting[i+1:]...)
					break
				}
			}
		}
		a.mu.Unlock()
		return ctx.Err()
	}
}
func (a *admission) release() { a.mu.Lock(); defer a.mu.Unlock(); a.releaseLocked() }
func (a *admission) releaseLocked() {
	if len(a.waiting) == 0 {
		a.active--
		return
	}
	index := 0
	preferContinuation := a.continuations < 2
	for i, w := range a.waiting {
		if w.continuation == preferContinuation {
			index = i
			break
		}
	}
	w := a.waiting[index]
	a.waiting = append(a.waiting[:index], a.waiting[index+1:]...)
	if w.continuation {
		a.continuations = min(2, a.continuations+1)
	} else {
		a.continuations = 0
	}
	w.granted = true
	close(w.ready)
}
