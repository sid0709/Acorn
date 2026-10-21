package resume

import (
	"testing"
	"time"
)

func TestRowVersionChangesWithTheFileNotWithItsBytes(t *testing.T) {
	uploaded := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	row := LibraryRow{ID: "a", FileName: "cv.pdf", Title: "Go", Size: 10, UploadedAt: uploaded}
	same := row
	same.Bytes = []byte("different bytes, same row")
	if rowVersion(row) != rowVersion(same) {
		t.Fatalf("bytes must not be part of a version: they are what the version saves reading")
	}
	for name, changed := range map[string]LibraryRow{
		"uploaded": {ID: "a", FileName: "cv.pdf", Title: "Go", Size: 10, UploadedAt: uploaded.Add(time.Second)},
		"size":     {ID: "a", FileName: "cv.pdf", Title: "Go", Size: 11, UploadedAt: uploaded},
		"title":    {ID: "a", FileName: "cv.pdf", Title: "Rust", Size: 10, UploadedAt: uploaded},
		"name":     {ID: "a", FileName: "cv.docx", Title: "Go", Size: 10, UploadedAt: uploaded},
		"primary":  {ID: "a", FileName: "cv.pdf", Title: "Go", Size: 10, UploadedAt: uploaded, IsPrimary: true},
	} {
		if rowVersion(changed) == rowVersion(row) {
			t.Fatalf("a change to %s must change the version", name)
		}
	}
}

func TestFileCacheTrustsACopyOnlyForItsWindow(t *testing.T) {
	const window = 30 * time.Second
	now := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	cache := &fileCache{trust: window, nowFn: func() time.Time { return now }}
	cache.put("k", LibraryRow{ID: "a", Bytes: []byte("file")})
	if _, fresh := cache.get("k"); !fresh {
		t.Fatalf("a copy just read must be trusted")
	}
	now = now.Add(window + time.Second)
	if copy, fresh := cache.get("k"); copy == nil || fresh {
		t.Fatalf("a copy past its window must be kept but asked about, got copy=%v fresh=%v", copy != nil, fresh)
	}
	cache.confirm("k")
	if _, fresh := cache.get("k"); !fresh {
		t.Fatalf("a copy Mongo confirmed must be trusted again")
	}
}

func TestFileCacheDropsTheLeastRecentlyUsedOverItsCap(t *testing.T) {
	now := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	cache := &fileCache{maxLen: 10, nowFn: func() time.Time { return now }}
	cache.put("old", LibraryRow{ID: "old", Bytes: make([]byte, 6)})
	now = now.Add(time.Second)
	cache.put("recent", LibraryRow{ID: "recent", Bytes: make([]byte, 4)})
	now = now.Add(time.Second)
	cache.get("old")
	now = now.Add(time.Second)
	cache.put("new", LibraryRow{ID: "new", Bytes: make([]byte, 4)})
	if copy, _ := cache.get("recent"); copy != nil {
		t.Fatalf("the copy used longest ago must go first")
	}
	if copy, _ := cache.get("old"); copy == nil {
		t.Fatalf("a copy used lately must stay")
	}
	if cache.total > 10 {
		t.Fatalf("the cache holds %d bytes over its cap of 10", cache.total)
	}
}

func TestFileCacheForgetsAnAccount(t *testing.T) {
	cache := &fileCache{}
	cache.put(fileKey("a", "1"), LibraryRow{ID: "1", Bytes: []byte("x")})
	cache.put(fileKey("b", "1"), LibraryRow{ID: "1", Bytes: []byte("y")})
	cache.forgetAccount("a")
	if copy, _ := cache.get(fileKey("a", "1")); copy != nil {
		t.Fatalf("the account's copy must be dropped")
	}
	if copy, _ := cache.get(fileKey("b", "1")); copy == nil {
		t.Fatalf("another account's copy must stay")
	}
}

// A stack's tag names the versions of every file it holds, so a client keeping the
// stack under that tag is told when any of its files changed.
func TestStackTagFollowsItsFiles(t *testing.T) {
	svc := New(NewMemory(), nil)
	putFile(t, svc, LibraryRow{ID: "go-pdf", Title: "Go", FileName: "go.pdf", Size: 4})
	putFile(t, svc, LibraryRow{ID: "go-docx", Title: "Go", FileName: "go.docx", Size: 5})
	_, first, err := svc.LibraryFileVersioned("a", "go-pdf")
	if err != nil || first == "" {
		t.Fatalf("tag = %q err = %v", first, err)
	}
	if _, again, _ := svc.LibraryFileVersioned("a", "go-docx"); again != first {
		t.Fatalf("both formats name one stack, got %q and %q", first, again)
	}
	putFile(t, svc, LibraryRow{ID: "go-docx", Title: "Go", FileName: "go.docx", Size: 6})
	if _, changed, _ := svc.LibraryFileVersioned("a", "go-pdf"); changed == first {
		t.Fatalf("a changed file in the stack must change its tag")
	}
}

func TestFileCacheWithNoWindowTrustsACopyUntilItIsDropped(t *testing.T) {
	now := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	cache := &fileCache{nowFn: func() time.Time { return now }}
	cache.put("k", LibraryRow{ID: "a", Bytes: []byte("file")})
	now = now.Add(24 * time.Hour)
	if _, fresh := cache.get("k"); !fresh {
		t.Fatalf("with no window a copy stays trusted however old it is")
	}
	if files, bytes := cache.usage(); files != 1 || bytes != 4 {
		t.Fatalf("usage = %d files, %d bytes", files, bytes)
	}
	if !cache.has("k") {
		t.Fatalf("has must say a copy is held")
	}
}

func TestTheDefaultCapIsEightGigabytes(t *testing.T) {
	if got := (&fileCache{}).limit(); got != 8<<30 {
		t.Fatalf("limit = %d", got)
	}
}
