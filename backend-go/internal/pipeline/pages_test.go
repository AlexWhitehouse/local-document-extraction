package pipeline

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestPageCacheEvictionKeepsReadersAndSelectionOrder(t *testing.T) {
	source := t.TempDir()
	first := filepath.Join(source, "first")
	second := filepath.Join(source, "second")
	if err := os.WriteFile(first, []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, []byte("second"), 0600); err != nil {
		t.Fatal(err)
	}
	c := newPageCache(t.TempDir(), 11)
	c.put([]string{"a", "b"}, []string{first, second})
	reader := t.TempDir()
	paths, bytes, err := c.lookup([]string{"b", "a"}, reader)
	if err != nil || bytes != 11 || len(paths) != 2 {
		t.Fatalf("lookup %v %d %v", paths, bytes, err)
	}
	c.put([]string{"c"}, []string{second})
	if c.bytes > c.limit {
		t.Fatal("cache exceeded allowance")
	}
	for i, want := range []string{"second", "first"} {
		got, err := os.ReadFile(paths[i])
		if err != nil || string(got) != want {
			t.Fatalf("reader after eviction: %q %v", got, err)
		}
	}
	missing, _, err := c.lookup([]string{"other-workspace/a"}, reader)
	if err != nil || missing != nil {
		t.Fatal("cross-workspace cache hit")
	}
}

func TestPageCacheConcurrentReadersAndEviction(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(source, []byte("page"), 0600); err != nil {
		t.Fatal(err)
	}
	c := newPageCache(t.TempDir(), 32)
	var wg sync.WaitGroup
	for i := range 12 {
		directory := t.TempDir()
		wg.Add(1)
		go func() {
			defer wg.Done()
			for turn := range 30 {
				key := fmt.Sprintf("%d-%d", i, turn%3)
				c.put([]string{key}, []string{source})
				paths, _, err := c.lookup([]string{key}, directory)
				if err != nil {
					t.Error(err)
					return
				}
				for _, path := range paths {
					data, err := os.ReadFile(path)
					if err != nil || string(data) != "page" {
						t.Errorf("invalid cached page %q %v", data, err)
					}
					_ = os.Remove(path)
				}
			}
		}()
	}
	wg.Wait()
	if c.bytes > c.limit {
		t.Fatal("cache exceeded allowance")
	}
}

func TestPageCacheExpiryPreservesActiveLinks(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(source, []byte("page"), 0600); err != nil {
		t.Fatal(err)
	}
	transport := &Transport{pages: newPageCache(t.TempDir(), 32)}
	transport.pages.put([]string{"page"}, []string{source})
	paths, _, err := transport.pages.lookup([]string{"page"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	transport.PrunePages(time.Now().Add(2 * time.Minute))
	if transport.pages.bytes != 0 || len(transport.pages.entries) != 0 {
		t.Fatal("abandoned page did not expire")
	}
	data, err := os.ReadFile(paths[0])
	if err != nil || string(data) != "page" {
		t.Fatal("expiration invalidated active upload")
	}
}
