package mailbox

import (
	"strings"
	"sync"
	"time"
)

// ttlCache is a small, bounded, in-process cache. Gmail reads are slow next to a
// map lookup, so repeat views (paging back, reopening a message) skip Google.
type ttlCache[V any] struct {
	mu      sync.Mutex
	ttl     time.Duration
	max     int
	entries map[string]ttlEntry[V]
}

type ttlEntry[V any] struct {
	value   V
	expires time.Time
}

func newTTLCache[V any](ttl time.Duration, max int) *ttlCache[V] {
	return &ttlCache[V]{ttl: ttl, max: max, entries: make(map[string]ttlEntry[V], max)}
}

func (c *ttlCache[V]) get(key string, now time.Time) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || !now.Before(entry.expires) {
		var zero V
		return zero, false
	}
	return entry.value, true
}

func (c *ttlCache[V]) set(key string, value V, now time.Time) {
	c.setFor(key, value, now, c.ttl)
}

func (c *ttlCache[V]) delete(key string) {
	c.mu.Lock()
	delete(c.entries, key)
	c.mu.Unlock()
}

// deletePrefix drops every entry whose key starts with prefix.
func (c *ttlCache[V]) deletePrefix(prefix string) {
	c.mu.Lock()
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			delete(c.entries, key)
		}
	}
	c.mu.Unlock()
}

// setFor stores value for its own lifetime, such as an access token's expiry.
func (c *ttlCache[V]) setFor(key string, value V, now time.Time, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; !ok && len(c.entries) >= c.max {
		c.evict(now)
	}
	c.entries[key] = ttlEntry[V]{value: value, expires: now.Add(ttl)}
}

// evict drops expired entries, then the one closest to expiry if still full.
func (c *ttlCache[V]) evict(now time.Time) {
	var oldestKey string
	var oldest time.Time
	for key, entry := range c.entries {
		if !now.Before(entry.expires) {
			delete(c.entries, key)
			continue
		}
		if oldestKey == "" || entry.expires.Before(oldest) {
			oldestKey, oldest = key, entry.expires
		}
	}
	if len(c.entries) >= c.max && oldestKey != "" {
		delete(c.entries, oldestKey)
	}
}
