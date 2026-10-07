package acorn

import (
	"bytes"
	"encoding/json"
	"errors"
)

// errNonJSON is what a planner call returns when no JSON object in the reply decodes.
var errNonJSON = errors.New("model returned non-JSON output")

// decodeModelJSON reads a structured-output reply into out. A reply is usually one
// JSON object, but a provider can break off a first attempt and start again in the
// same reply (a cut-off object, stray text, then the whole object). When the reply
// is not one object, the longest complete object in it is the answer: a fragment
// nested inside a cut-off attempt is always shorter than the full object.
func decodeModelJSON(text string, out any) error {
	raw := []byte(text)
	if json.Unmarshal(raw, out) == nil {
		return nil
	}
	var best json.RawMessage
	for start := 0; start < len(raw); {
		open := bytes.IndexByte(raw[start:], '{')
		if open < 0 {
			break
		}
		at := start + open
		decoder := json.NewDecoder(bytes.NewReader(raw[at:]))
		var object json.RawMessage
		if decoder.Decode(&object) != nil {
			start = at + 1
			continue
		}
		if len(object) > len(best) {
			best = object
		}
		start = at + int(decoder.InputOffset())
	}
	if best == nil || json.Unmarshal(best, out) != nil {
		return errNonJSON
	}
	return nil
}
