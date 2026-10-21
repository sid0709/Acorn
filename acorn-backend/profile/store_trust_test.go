package profile

import (
	"testing"
	"time"
)

func TestAProfileIsKeptUntilASaveUnlessAWindowIsSet(t *testing.T) {
	store := NewMemory()
	store.keep("acct", Document{FullName: "Ada"})
	store.readAt["acct"] = time.Now().Add(-24 * time.Hour)
	if _, ok := store.fresh("acct"); !ok {
		t.Fatal("with no window a profile is served however old the copy is")
	}
	store.SetTrust(time.Minute)
	if _, ok := store.fresh("acct"); ok {
		t.Fatal("with a window an older copy is read again")
	}
	store.keep("acct", Document{FullName: "Ada"})
	if _, ok := store.fresh("acct"); !ok {
		t.Fatal("a copy just kept is served")
	}
}
