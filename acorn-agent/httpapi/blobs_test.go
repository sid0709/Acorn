package httpapi

import (
	"strings"
	"testing"
	"time"
)

// picture is a stand-in data URL of about n bytes.
func picture(n int, seed string) string {
	return "data:image/jpeg;base64," + strings.Repeat(seed, n/len(seed)+1)[:n]
}

func TestAPictureKeptOnceIsFoundByItsHashAndForgottenWithTheRun(t *testing.T) {
	store := newBlobStore(1<<20, time.Hour, time.Now)
	one := picture(1000, "a")
	hash := store.put("run", one)
	if hash != blobHash(one) || len(hash) != 64 {
		t.Fatalf("hash = %q", hash)
	}
	if got, ok := store.get("run", hash); !ok || got != one {
		t.Fatalf("get = %q %v", got[:20], ok)
	}
	if _, ok := store.get("other", hash); ok {
		t.Fatal("another run can see this run's picture")
	}
	store.forget("run")
	if _, ok := store.get("run", hash); ok {
		t.Fatal("a forgotten run's picture is still held")
	}
}

func TestTheOldestPicturesLeaveWhenARunHoldsMoreThanItsShare(t *testing.T) {
	store := newBlobStore(2500, time.Hour, time.Now)
	first := store.put("run", picture(1000, "a"))
	second := store.put("run", picture(1000, "b"))
	// The first is used again, so it is now the newer of the two.
	if _, ok := store.get("run", first); !ok {
		t.Fatal("the first picture is gone too soon")
	}
	third := store.put("run", picture(1000, "c"))
	if _, ok := store.get("run", second); ok {
		t.Fatal("the picture least recently used was not the one to go")
	}
	for _, hash := range []string{first, third} {
		if _, ok := store.get("run", hash); !ok {
			t.Fatalf("%s should still be held", hash[:8])
		}
	}
	if want := len(picture(1000, "a")) + len(picture(1000, "c")); store.bytes() != want {
		t.Fatalf("bytes = %d, want %d", store.bytes(), want)
	}
}

func TestARunNobodyTouchedForTheSessionsLifetimeIsDropped(t *testing.T) {
	now := time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC)
	store := newBlobStore(1<<20, time.Hour, func() time.Time { return now })
	hash := store.put("idle", picture(100, "a"))
	now = now.Add(2 * time.Hour)
	store.put("busy", picture(100, "b"))
	if _, ok := store.get("idle", hash); ok {
		t.Fatal("an idle run's pictures were kept past the session's lifetime")
	}
}

func TestResolvePutsPicturesBackAndNamesTheMissingOnes(t *testing.T) {
	store := newBlobStore(1<<20, time.Hour, time.Now)
	shot := picture(500, "s")
	// A request that carries a picture and refers to it again needs it once.
	first, again := shot, blobRef(blobHash(shot))
	if missing := store.resolve("run", []*string{&first, &again}, true); missing != nil {
		t.Fatalf("missing = %v", missing)
	}
	if again != shot {
		t.Fatalf("the reference was not put back: %q", again[:20])
	}
	// A reference to a picture never sent is named, and nothing is changed.
	known, unknown := blobRef(blobHash(shot)), blobRef(strings.Repeat("0", 64))
	if missing := store.resolve("run", []*string{&known, &unknown}, true); len(missing) != 1 || missing[0] != strings.Repeat("0", 64) {
		t.Fatalf("missing = %v", missing)
	}
	if !isBlobRef(known) {
		t.Fatal("a field was changed although another was missing")
	}
	// Without keep, a picture is looked at and not held.
	once := picture(300, "o")
	if missing := store.resolve("run", []*string{&once}, false); missing != nil {
		t.Fatalf("missing = %v", missing)
	}
	if _, ok := store.get("run", blobHash(once)); ok {
		t.Fatal("a picture resolved without keep was held")
	}
}
