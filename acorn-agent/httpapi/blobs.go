package httpapi

import (
	"container/list"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/acorn/acorn-agent/agent"
)

// The extension sends many pictures more than once: a survey screen it reused from the last survey, a zone
// photo it posted mid-batch and sends again with the look after, the look's own screenshot that is also a
// screen of its survey. Over a slow line those bytes are most of a run's time. So every picture a run sends
// is kept here by its hash for the rest of the run, and the extension sends a picture it has sent before as
// a reference, "ref:sha256:<hex>", which is swapped for the picture before the agent sees the request. The
// agent is given exactly what it was given before: the same data URLs, in the same fields.
//
// A reference the store cannot resolve is answered with the hashes that are missing (code missing_blobs),
// and the extension sends those pictures as bytes. So the store may forget: each run keeps at most
// maxBlobBytesPerSession, the oldest picture leaving first, and a run nobody has touched for the session's
// lifetime is dropped with it.

const (
	// blobRefPrefix starts a reference to a picture sent before; the rest is the picture's SHA-256 as hex.
	blobRefPrefix = "ref:sha256:"
	// maxBlobBytesPerSession bounds the pictures one run keeps: the last survey, the zone photos of a plan
	// and a few looks fit well within it.
	maxBlobBytesPerSession = 16 << 20
	// defaultBlobTTL is how long a run's pictures are kept when the server has no session lifetime to go by.
	defaultBlobTTL = time.Hour
	// codeMissingBlobs is the error code of a request that referred to a picture the server does not hold.
	codeMissingBlobs = "missing_blobs"
)

// blobHash is how a picture is named: the SHA-256 of its data URL, as hex. The extension computes the same.
func blobHash(dataURL string) string {
	sum := sha256.Sum256([]byte(dataURL))
	return hex.EncodeToString(sum[:])
}

// isBlobRef is whether a picture field holds a reference instead of a data URL.
func isBlobRef(value string) bool { return strings.HasPrefix(value, blobRefPrefix) }

// blobRef is the reference to a picture with this hash.
func blobRef(hash string) string { return blobRefPrefix + hash }

type blob struct {
	hash string
	data string
}

// sessionBlobs is one run's pictures, newest at the back.
type sessionBlobs struct {
	items   map[string]*list.Element
	order   *list.List
	bytes   int
	touched time.Time
}

// blobStore keeps every live run's pictures.
type blobStore struct {
	mu       sync.Mutex
	sessions map[string]*sessionBlobs
	capBytes int
	ttl      time.Duration
	now      func() time.Time
}

func newBlobStore(capBytes int, ttl time.Duration, now func() time.Time) *blobStore {
	if ttl <= 0 {
		ttl = defaultBlobTTL
	}
	if now == nil {
		now = time.Now
	}
	return &blobStore{sessions: map[string]*sessionBlobs{}, capBytes: capBytes, ttl: ttl, now: now}
}

// put keeps a picture for a run and says its hash. A picture already held moves to the newest place.
func (b *blobStore) put(session, dataURL string) string {
	hash := blobHash(dataURL)
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sweepLocked()
	run := b.sessions[session]
	if run == nil {
		run = &sessionBlobs{items: map[string]*list.Element{}, order: list.New()}
		b.sessions[session] = run
	}
	run.touched = b.now()
	if element, ok := run.items[hash]; ok {
		run.order.MoveToBack(element)
		return hash
	}
	run.items[hash] = run.order.PushBack(blob{hash: hash, data: dataURL})
	run.bytes += len(dataURL)
	for run.bytes > b.capBytes && run.order.Len() > 1 {
		oldest := run.order.Front()
		run.order.Remove(oldest)
		old := oldest.Value.(blob)
		delete(run.items, old.hash)
		run.bytes -= len(old.data)
	}
	return hash
}

// get is the picture a run sent before with this hash, if it is still held.
func (b *blobStore) get(session, hash string) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	run := b.sessions[session]
	if run == nil {
		return "", false
	}
	element, ok := run.items[hash]
	if !ok {
		return "", false
	}
	run.touched = b.now()
	run.order.MoveToBack(element)
	return element.Value.(blob).data, true
}

// forget drops a run's pictures: the run ended.
func (b *blobStore) forget(session string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.sessions, session)
}

// bytes is how much every live run's pictures take, for the health route.
func (b *blobStore) bytes() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	total := 0
	for _, run := range b.sessions {
		total += run.bytes
	}
	return total
}

// sweepLocked drops the pictures of runs nobody has touched for the session's lifetime: the agent has
// dropped those sessions too.
func (b *blobStore) sweepLocked() {
	cutoff := b.now().Add(-b.ttl)
	for id, run := range b.sessions {
		if run.touched.Before(cutoff) {
			delete(b.sessions, id)
		}
	}
}

// resolve swaps every reference among fields for the picture it names and, when keep is set, keeps every
// picture the fields carry, so the rest of the run can refer to them. The pictures are kept first, so a
// request that carries a picture and refers to it again in another field needs it only once. It reports
// the references it could not resolve; the fields are left as they came when any is missing.
func (b *blobStore) resolve(session string, fields []*string, keep bool) (missing []string) {
	for _, field := range fields {
		if keep && *field != "" && !isBlobRef(*field) {
			b.put(session, *field)
		}
	}
	found := map[*string]string{}
	for _, field := range fields {
		if !isBlobRef(*field) {
			continue
		}
		hash := strings.TrimPrefix(*field, blobRefPrefix)
		data, ok := b.get(session, hash)
		if !ok {
			missing = append(missing, hash)
			continue
		}
		found[field] = data
	}
	if len(missing) > 0 {
		return missing
	}
	for field, data := range found {
		*field = data
	}
	return nil
}

// observationImages is every picture field of a look.
func observationImages(obs *agent.Observation) []*string {
	fields := []*string{&obs.Screenshot}
	for i := range obs.Survey {
		fields = append(fields, &obs.Survey[i].Screenshot)
	}
	for i := range obs.ZoneShots {
		fields = append(fields, &obs.ZoneShots[i].Screenshot)
	}
	return fields
}

// blobsUpload is pictures sent ahead of the look that will refer to them.
type blobsUpload struct {
	Images []string `json:"images"`
}

// blobsKept answers with the hash of each picture, in the order they came.
type blobsKept struct {
	Hashes []string `json:"hashes"`
}
