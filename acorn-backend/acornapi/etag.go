package acornapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
)

// etagBytes is how much of the content hash names a version: enough that two
// versions of one file never share it.
const etagBytes = 16

// writeJSONVersioned answers a file's JSON with an ETag naming its content, and
// with 304 Not Modified when the client already holds that version: an unchanged
// résumé costs the extension one small round trip instead of its whole body.
func writeJSONVersioned(w http.ResponseWriter, r *http.Request, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not encode the file")
		return
	}
	sum := sha256.Sum256(body)
	tag := `"` + hex.EncodeToString(sum[:etagBytes]) + `"`
	w.Header().Set("ETag", tag)
	// Private to the account, and checked with the server on every use.
	w.Header().Set("Cache-Control", "private, no-cache")
	if etagMatches(r.Header.Get("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// etagMatches reads an If-None-Match header: a list of tags, or * for any.
func etagMatches(header, tag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(candidate), "W/"))
		if candidate == tag || candidate == "*" {
			return true
		}
	}
	return false
}

// writeFileTagged answers a file's JSON under a tag the caller already holds for
// its content (the versions it was built from), with 304 Not Modified when the
// client has that tag. The body is not encoded at all for a 304.
func writeFileTagged(w http.ResponseWriter, r *http.Request, tag string, value any) {
	if tag == "" {
		writeJSONVersioned(w, r, value)
		return
	}
	quoted := `"` + tag + `"`
	w.Header().Set("ETag", quoted)
	w.Header().Set("Cache-Control", "private, no-cache")
	if etagMatches(r.Header.Get("If-None-Match"), quoted) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, value)
}
