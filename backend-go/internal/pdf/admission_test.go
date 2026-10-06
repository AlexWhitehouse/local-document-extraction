package pdf

import (
	"context"
	"testing"
	"time"
)

func TestPDFFairnessIncludesChildrenWithoutStarvingNewUploads(t *testing.T) {
	a := &admission{capacity: 1}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := a.acquire(ctx, false); err != nil {
		t.Fatal(err)
	}
	order := make(chan int, 4)
	// Queue two parents before two children, as a split upload burst would do.
	for i := 0; i < 4; i++ {
		go func(i int) {
			if a.acquire(ctx, i >= 2) == nil {
				order <- i
				a.release()
			}
		}(i)
		deadline := time.Now().Add(time.Second)
		for {
			a.mu.Lock()
			queued := len(a.waiting)
			a.mu.Unlock()
			if queued == i+1 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("waiter not admitted")
			}
			time.Sleep(time.Millisecond)
		}
	}
	a.release()
	for _, expected := range []int{2, 3, 0, 1} {
		select {
		case got := <-order:
			if got != expected {
				t.Fatalf("got %d, expected %d", got, expected)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
}

func TestCanceledPDFWaitDoesNotLeakAdmission(t *testing.T) {
	a := &admission{capacity: 1}
	if err := a.acquire(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- a.acquire(ctx, true) }()
	deadline := time.Now().Add(time.Second)
	for {
		a.mu.Lock()
		queued := len(a.waiting)
		a.mu.Unlock()
		if queued == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("waiter not queued")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if <-done != context.Canceled {
		t.Fatal("canceled waiter admitted")
	}
	a.release()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.active != 0 || len(a.waiting) != 0 {
		t.Fatal("admission leaked")
	}
}
