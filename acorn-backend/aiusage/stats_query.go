package aiusage

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// Ranges the statistics can cover. Each compares against the period just before it.
const (
	Range24h     = "24h"
	Range7d      = "7d"
	Range30d     = "30d"
	Range90d     = "90d"
	DefaultRange = Range7d

	bucketHour = "hour"
	bucketDay  = "day"
)

var rangeLengths = map[string]time.Duration{
	Range24h: 24 * time.Hour,
	Range7d:  7 * 24 * time.Hour,
	Range30d: 30 * 24 * time.Hour,
	Range90d: 90 * 24 * time.Hour,
}

// ValidRange reports whether r is one of the Range values.
func ValidRange(r string) bool {
	_, ok := rangeLengths[r]
	return ok
}

// Filter narrows the statistics. Empty fields match everything. Support-session
// calls are left out unless IncludeSupport is set, so an admin's checks do not
// count as the user's own use.
type Filter struct {
	Range          string
	AccountID      string
	Model          string
	Feature        string
	Client         string
	IncludeSupport bool
}

// Window is a half-open time span [From, To) and the series bucket that suits it.
type Window struct {
	From   time.Time `json:"from"`
	To     time.Time `json:"to"`
	Bucket string    `json:"bucket"`
}

func (f Filter) rangeKey() string {
	if ValidRange(f.Range) {
		return f.Range
	}
	return DefaultRange
}

// windows are the current period ending at now and the equal period before it.
func (f Filter) windows(now time.Time) (Window, Window) {
	length := rangeLengths[f.rangeKey()]
	bucket := bucketDay
	if length <= rangeLengths[Range24h] {
		bucket = bucketHour
	}
	to := now.UTC()
	current := Window{From: to.Add(-length), To: to, Bucket: bucket}
	previous := Window{From: current.From.Add(-length), To: current.From, Bucket: bucket}
	return current, previous
}

// match is the $match for this filter over one window.
func (f Filter) match(w Window) bson.M {
	m := bson.M{"createdAt": bson.M{"$gte": w.From, "$lt": w.To}}
	if f.AccountID != "" {
		m["accountId"] = f.AccountID
	}
	if f.Model != "" {
		m["model"] = f.Model
	}
	if f.Feature != "" {
		m["feature"] = f.Feature
	}
	if f.Client != "" {
		m["client"] = f.Client
	}
	if !f.IncludeSupport {
		m["supportBy"] = ""
	}
	return m
}
