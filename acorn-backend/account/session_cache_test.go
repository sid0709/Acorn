package account

import (
	"testing"
	"time"
)

func TestSessionCacheTrustsACheckWithinTheTTL(t *testing.T) {
	cache := newSessionCache()
	now := time.Now()
	session := Session{User: User{ID: "u1"}, ExpiresAt: now.Add(time.Hour)}
	cache.put("h", session, now)
	if got, ok := cache.get("h", now.Add(sessionCacheTTL/2)); !ok || got.User.ID != "u1" {
		t.Fatalf("get within TTL = %+v %v", got, ok)
	}
	if _, ok := cache.get("h", now.Add(sessionCacheTTL)); ok {
		t.Fatal("a check older than the TTL must be made again")
	}
}

func TestSessionCacheDropsExpiredAndEndedSessions(t *testing.T) {
	cache := newSessionCache()
	now := time.Now()
	cache.put("soon", Session{User: User{ID: "u1"}, ExpiresAt: now.Add(time.Second)}, now)
	if _, ok := cache.get("soon", now.Add(2*time.Second)); ok {
		t.Fatal("an expired session must not be served")
	}
	cache.put("a", Session{User: User{ID: "u1"}, ExpiresAt: now.Add(time.Hour)}, now)
	cache.put("b", Session{User: User{ID: "u2"}, ExpiresAt: now.Add(time.Hour)}, now)
	cache.forgetUser("u1")
	if _, ok := cache.get("a", now); ok {
		t.Fatal("ending a user's sessions must drop them")
	}
	if _, ok := cache.get("b", now); !ok {
		t.Fatal("another user's session must stay")
	}
	cache.forget("b")
	if _, ok := cache.get("b", now); ok {
		t.Fatal("signing out must drop the session")
	}
}
