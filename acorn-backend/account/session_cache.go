package account

import (
	"sync"
	"time"
)

// sessionCacheTTL is how long a checked session is trusted without asking the
// database again. Every signed-in request checks its session: two round trips
// (the session, then its account) before any work. Ending a session through this
// process clears it at once; a change made elsewhere is seen within the TTL.
const sessionCacheTTL = 30 * time.Second

type cachedSession struct {
	session Session
	at      time.Time
}

// sessionCache keeps checked sessions by token hash.
type sessionCache struct {
	mu   sync.Mutex
	rows map[string]cachedSession
}

func newSessionCache() *sessionCache {
	return &sessionCache{rows: map[string]cachedSession{}}
}

// get is the session behind tokenHash when it was checked within the TTL and has
// not expired since.
func (c *sessionCache) get(tokenHash string, now time.Time) (Session, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	row, ok := c.rows[tokenHash]
	if !ok {
		return Session{}, false
	}
	if now.Sub(row.at) >= sessionCacheTTL || !row.session.ExpiresAt.After(now) {
		delete(c.rows, tokenHash)
		return Session{}, false
	}
	return row.session, true
}

func (c *sessionCache) put(tokenHash string, session Session, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rows[tokenHash] = cachedSession{session: session, at: now}
}

// forget drops one session (signed out).
func (c *sessionCache) forget(tokenHash string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.rows, tokenHash)
}

// forgetUser drops every session of one account (deactivated, support ended).
func (c *sessionCache) forgetUser(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for hash, row := range c.rows {
		if row.session.User.ID == userID {
			delete(c.rows, hash)
		}
	}
}
