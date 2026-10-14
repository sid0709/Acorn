package resume

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"golang.org/x/sync/singleflight"
)

// A Library file is hundreds of KB and Mongo hands it over slowly (seconds per
// file), so a file read once stays in memory. A copy is trusted for fileTrustTTL;
// after that one cheap query without the bytes says whether it is still current,
// and only a changed file is read again. A write through this process drops the
// copy at once.
const (
	// fileTrustTTL is how long a copy is served without asking Mongo anything. A
	// change made by another server process is seen within it.
	fileTrustTTL = 30 * time.Second
	// fileCacheMaxBytes caps the bytes kept; the copies used longest ago go first.
	fileCacheMaxBytes = 256 << 20
	// versionTagBytes is how much of the version hash names a file in an ETag.
	versionTagBytes = 16
)

// fileMetaFields is all a version reads about a Library row: never its bytes or text.
var fileMetaFields = bson.D{
	{Key: "id", Value: 1}, {Key: "uploadedAt", Value: 1}, {Key: "size", Value: 1},
	{Key: "fileName", Value: 1}, {Key: "title", Value: 1}, {Key: "mimeType", Value: 1},
	{Key: "jobId", Value: 1}, {Key: "kind", Value: 1}, {Key: "isPrimary", Value: 1},
	{Key: "analyzedAt", Value: 1}, {Key: "analyzed", Value: 1},
}

// rowVersion names what a row holds. Two reads with the same version hold the
// same file and the same fields, so a copy with that version needs no new read.
func rowVersion(row LibraryRow) string {
	analyzed := int64(0)
	if row.AnalyzedAt != nil {
		analyzed = row.AnalyzedAt.UnixMilli()
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%s|%s|%s|%s|%s|%t|%d|%t",
		row.ID, row.UploadedAt.UnixMilli(), row.Size, row.FileName, row.Title, row.MimeType,
		row.JobID, row.Kind, row.IsPrimary, analyzed, row.Analyzed)))
	return hex.EncodeToString(sum[:versionTagBytes])
}

// joinVersions names a set of rows (a stack's files) as one tag.
func joinVersions(rows []LibraryRow, versions map[string]string) string {
	sum := sha256.New()
	for _, row := range rows {
		sum.Write([]byte(versions[row.ID]))
		sum.Write([]byte{0})
	}
	return hex.EncodeToString(sum.Sum(nil)[:versionTagBytes])
}

type cachedFile struct {
	row       LibraryRow
	version   string
	checkedAt time.Time
	usedAt    time.Time
}

// fileCache keeps whole Library rows (with their bytes) by account and id.
type fileCache struct {
	mu     sync.Mutex
	files  map[string]*cachedFile
	total  int
	loads  singleflight.Group
	nowFn  func() time.Time
	maxLen int
}

func fileKey(accountID, id string) string { return accountID + "\x00" + id }

func (c *fileCache) now() time.Time {
	if c.nowFn != nil {
		return c.nowFn()
	}
	return time.Now()
}

func (c *fileCache) limit() int {
	if c.maxLen > 0 {
		return c.maxLen
	}
	return fileCacheMaxBytes
}

// get is the copy for key and whether it is still inside its trust window.
func (c *fileCache) get(key string) (*cachedFile, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	file, ok := c.files[key]
	if !ok {
		return nil, false
	}
	file.usedAt = c.now()
	return file, c.now().Sub(file.checkedAt) < fileTrustTTL
}

// confirm renews a copy that Mongo said is still current.
func (c *fileCache) confirm(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if file, ok := c.files[key]; ok {
		file.checkedAt = c.now()
	}
}

func (c *fileCache) put(key string, row LibraryRow) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.files == nil {
		c.files = map[string]*cachedFile{}
	}
	if old, ok := c.files[key]; ok {
		c.total -= len(old.row.Bytes)
	}
	now := c.now()
	c.files[key] = &cachedFile{row: row, version: rowVersion(row), checkedAt: now, usedAt: now}
	c.total += len(row.Bytes)
	for c.total > c.limit() && len(c.files) > 1 {
		var oldest string
		var oldestAt time.Time
		for name, file := range c.files {
			if name == key {
				continue
			}
			if oldest == "" || file.usedAt.Before(oldestAt) {
				oldest, oldestAt = name, file.usedAt
			}
		}
		if oldest == "" {
			break
		}
		c.total -= len(c.files[oldest].row.Bytes)
		delete(c.files, oldest)
	}
}

// forget drops one copy after the file changed or was removed.
func (c *fileCache) forget(accountID, id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := fileKey(accountID, id)
	if old, ok := c.files[key]; ok {
		c.total -= len(old.row.Bytes)
		delete(c.files, key)
	}
}

// forgetAccount drops every copy the account has.
func (c *fileCache) forgetAccount(accountID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prefix := accountID + "\x00"
	for key, file := range c.files {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			c.total -= len(file.row.Bytes)
			delete(c.files, key)
		}
	}
}

// libraryFileRow is one Library row with its bytes, from memory when the copy is
// current. Calls for the same file at once share one read.
func (s *Store) libraryFileRow(accountID, id string) (LibraryRow, string, bool) {
	if s.db == nil {
		s.mu.Lock()
		row, ok := s.library[id]
		s.mu.Unlock()
		if !ok || row.AccountID != accountID {
			return LibraryRow{}, "", false
		}
		return row, rowVersion(row), true
	}
	key := fileKey(accountID, id)
	if cached, fresh := s.files.get(key); cached != nil && fresh {
		return cached.row, cached.version, true
	}
	type loaded struct {
		row     LibraryRow
		version string
	}
	value, _, _ := s.files.loads.Do(key, func() (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), fileReadTimeout)
		defer cancel()
		cached, _ := s.files.get(key)
		if cached != nil {
			var meta LibraryRow
			err := s.db.Collection(libraryCollection).FindOne(ctx,
				bson.D{{Key: "id", Value: id}, {Key: "accountId", Value: accountID}},
				options.FindOne().SetProjection(fileMetaFields)).Decode(&meta)
			if err == nil && rowVersion(meta) == cached.version {
				s.files.confirm(key)
				return loaded{cached.row, cached.version}, nil
			}
		}
		var found LibraryRow
		err := s.db.Collection(libraryCollection).FindOne(ctx,
			bson.D{{Key: "id", Value: id}, {Key: "accountId", Value: accountID}}).Decode(&found)
		if err != nil {
			s.files.forget(accountID, id)
			return nil, err
		}
		s.files.put(key, found)
		return loaded{found, rowVersion(found)}, nil
	})
	result, ok := value.(loaded)
	if !ok {
		return LibraryRow{}, "", false
	}
	return result.row, result.version, true
}

// fileReadTimeout bounds one file read from Mongo, so a stalled link ends the
// request instead of holding a run for minutes.
const fileReadTimeout = 60 * time.Second
