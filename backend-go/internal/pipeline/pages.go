package pipeline

import (
	"container/list"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

type cachedPage struct {
	key, path string
	bytes     int64
	lastUsed  time.Time
}

// The cache owns hard links, not durable work. Each reader gets another link in
// its run directory, so eviction and packet cleanup cannot invalidate a request.
// Keys use immutable source ownership, never content hashes across submissions.
type pageCache struct {
	mu           sync.Mutex
	directory    string
	limit, bytes int64
	order        *list.List
	entries      map[string]*list.Element
	hits, misses atomic.Uint64
}

func newPageCache(directory string, limit int64) *pageCache {
	return &pageCache{directory: directory, limit: limit, order: list.New(), entries: make(map[string]*list.Element)}
}

func (t *Transport) EnablePageCache(directory string, limit int64) {
	t.pages = newPageCache(directory, limit)
}

func (t *Transport) PageCacheStats() map[string]any {
	if t.pages == nil {
		return map[string]any{}
	}
	c := t.pages
	c.mu.Lock()
	defer c.mu.Unlock()
	return map[string]any{"bytes": c.bytes, "limit": c.limit, "pages": len(c.entries), "hits": c.hits.Load(), "misses": c.misses.Load()}
}

func pageKeys(task ModelTask) ([]string, error) {
	if !task.Render || task.CacheID == "" || len(task.Pages) == 0 {
		return nil, nil
	}
	info, err := os.Stat(task.Source)
	if err != nil {
		return nil, err
	}
	keys := make([]string, len(task.Pages))
	for i, page := range task.Pages {
		keys[i] = fmt.Sprintf("%s:%d:%d:%d", task.CacheID, info.Size(), info.ModTime().UnixNano(), page)
	}
	return keys, nil
}

// Lookup is all-or-nothing for a page selection. Links are made while locked;
// callers then account for their own lifetime in the existing artifact budget.
func (c *pageCache) lookup(keys []string, directory string) ([]string, int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, key := range keys {
		if c.entries[key] == nil {
			c.misses.Add(uint64(len(keys)))
			return nil, 0, nil
		}
	}
	var paths []string
	var bytes int64
	for _, key := range keys {
		element := c.entries[key]
		page := element.Value.(cachedPage)
		file, err := os.CreateTemp(directory, "artifact-")
		if err == nil {
			err = file.Close()
		}
		path := ""
		if file != nil {
			path = file.Name()
			_ = os.Remove(path)
		}
		if err == nil {
			err = os.Link(page.path, path)
		}
		if err != nil {
			for _, created := range paths {
				_ = os.Remove(created)
			}
			return nil, 0, err
		}
		paths = append(paths, path)
		bytes += page.bytes
		page.lastUsed = time.Now()
		element.Value = page
		c.order.MoveToFront(element)
	}
	c.hits.Add(uint64(len(keys)))
	return paths, bytes, nil
}

func (c *pageCache) put(keys, paths []string) {
	if len(keys) != len(paths) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, key := range keys {
		if element := c.entries[key]; element != nil {
			page := element.Value.(cachedPage)
			page.lastUsed = time.Now()
			element.Value = page
			c.order.MoveToFront(element)
			continue
		}
		info, err := os.Stat(paths[i])
		if err != nil || info.Size() > c.limit {
			continue
		}
		for c.bytes+info.Size() > c.limit {
			oldest := c.order.Back()
			page := oldest.Value.(cachedPage)
			if os.Remove(page.path) != nil {
				return
			}
			c.bytes -= page.bytes
			delete(c.entries, page.key)
			c.order.Remove(oldest)
		}
		file, err := os.CreateTemp(c.directory, "page-")
		if err != nil {
			return
		}
		name := file.Name()
		_ = file.Close()
		_ = os.Remove(name)
		if os.Link(paths[i], name) != nil {
			continue
		}
		c.bytes += info.Size()
		c.entries[key] = c.order.PushFront(cachedPage{key: key, path: filepath.Clean(name), bytes: info.Size(), lastUsed: time.Now()})
	}
}

func (c *pageCache) remove(keys []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, key := range keys {
		element := c.entries[key]
		if element == nil {
			continue
		}
		page := element.Value.(cachedPage)
		if os.Remove(page.path) != nil {
			continue
		}
		c.bytes -= page.bytes
		delete(c.entries, key)
		c.order.Remove(element)
	}
}

// Abandoned/deleted children never need to run to reclaim their cached pixels.
func (t *Transport) PrunePages(now time.Time) {
	c := t.pages
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for element := c.order.Back(); element != nil; {
		page := element.Value.(cachedPage)
		if now.Sub(page.lastUsed) < time.Minute {
			break
		}
		previous := element.Prev()
		if os.Remove(page.path) == nil {
			c.bytes -= page.bytes
			delete(c.entries, page.key)
			c.order.Remove(element)
		}
		element = previous
	}
}
