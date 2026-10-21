package resume

import (
	"sync"
	"time"
)

// accountReadTTL is how long one account's rows read from Mongo are served from
// memory. The website reads them on every Résumé visit and the extension around
// every fill; a write through this process clears the account's copy at once, and
// one made elsewhere (a support session on another process) is seen within the TTL.
// A collection can be kept until a write instead (keepUntilChanged), as the Library is.
const accountReadTTL = 30 * time.Second

type accountRead struct {
	rows any
	at   time.Time
}

// accountReads keeps recent per-account reads, by collection.
type accountReads struct {
	mu   sync.Mutex
	rows map[string]accountRead
	// window is how long a collection's reads are served from memory; a collection with an
	// entry here uses it instead of accountReadTTL, and zero means until a write clears it.
	window map[string]time.Duration
}

// keepFor sets how long a collection's reads are served from memory; zero keeps them until a
// write clears them.
func (c *accountReads) keepFor(collection string, window time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.window == nil {
		c.window = map[string]time.Duration{}
	}
	c.window[collection] = window
}

func readKey(collection, accountID string) string { return collection + "\x00" + accountID }

func (c *accountReads) get(collection, accountID string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	row, ok := c.rows[readKey(collection, accountID)]
	if !ok {
		return nil, false
	}
	window := accountReadTTL
	if custom, set := c.window[collection]; set {
		window = custom
	}
	if window > 0 && time.Since(row.at) >= window {
		return nil, false
	}
	return row.rows, true
}

func (c *accountReads) put(collection, accountID string, rows any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.rows == nil {
		c.rows = map[string]accountRead{}
	}
	c.rows[readKey(collection, accountID)] = accountRead{rows: rows, at: time.Now()}
}

// forget drops one account's copy of a collection after a write to it.
func (c *accountReads) forget(collection, accountID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.rows, readKey(collection, accountID))
}

// forgetAccount drops every copy the account has (its data was deleted).
func (c *accountReads) forgetAccount(accountID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.rows {
		if len(key) > len(accountID) && key[len(key)-len(accountID):] == accountID && key[len(key)-len(accountID)-1] == 0 {
			delete(c.rows, key)
		}
	}
}

// cachedAccountRows is loadAccount served from the recent-read cache. The cache
// keeps its own copy, so a caller changing the rows it got cannot change the next.
func cachedAccountRows[T any](s *Store, collection, accountID, omit string) ([]T, bool) {
	if rows, ok := s.reads.get(collection, accountID); ok {
		if typed, ok := rows.([]T); ok {
			return append([]T(nil), typed...), true
		}
	}
	rows, ok := loadAccount[T](s, collection, accountID, omit)
	if ok {
		s.reads.put(collection, accountID, append([]T(nil), rows...))
	}
	return rows, ok
}
