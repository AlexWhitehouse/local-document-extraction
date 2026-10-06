package pipeline

import (
	"context"
	"testing"
	"time"
)

func TestArtifactBudgetRefundCancellationAndOversize(t *testing.T) {
	b := newByteBudget(100)
	if err := b.acquire(context.Background(), 80); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- b.acquire(ctx, 30) }()
	select {
	case <-done:
		t.Fatal("exceeded byte budget")
	case <-time.After(10 * time.Millisecond):
	}
	cancel()
	if <-done != context.Canceled {
		t.Fatal("cancellation lost")
	}
	if b.Used() != 80 {
		t.Fatal("canceled waiter reserved bytes")
	}
	go func() { done <- b.acquire(context.Background(), 30) }()
	b.release(20)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if b.Used() != 90 {
		t.Fatal("refund not reused")
	}
	b.release(90)
	if err := b.acquire(context.Background(), 101); err == nil {
		t.Fatal("oversize accepted")
	}
}
