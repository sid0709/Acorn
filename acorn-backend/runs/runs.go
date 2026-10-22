// Package runs keeps the agent Runs that sent an application, one row each: the link of the job,
// when it went in, how long the Run worked and what the models cost. The website shows them as
// the person's daily progress.
package runs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sid0709/acorn/acorn-backend/config"
	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	// MaxURL and MaxTitle bound what a row keeps of the page the Run started on. The extension
	// cuts to the same lengths (acorn/packages/shared/runs.ts).
	MaxURL   = 2048
	MaxTitle = 200
	// maxKey bounds the ids a record carries.
	maxKey = 64

	// DefaultRecent and MaxRecent are how many of the newest Runs a list returns.
	DefaultRecent = 24
	MaxRecent     = 100
	// MaxDailyDays is the longest span of days one daily read covers.
	MaxDailyDays = 400

	// maxDurationMs is a day of work; more is a clock that went wrong.
	maxDurationMs = 24 * 60 * 60 * 1000
	// maxCostNanos is $100 in nanodollars, far above what one application costs.
	maxCostNanos = 100_000_000_000
	// maxCount bounds the steps, model calls and screen checks of one Run.
	maxCount = 100_000

	// A Run's end may be sent long after it happened (a queue holds it while the browser is
	// offline), but not before Acorn existed, and a clock ahead of ours by more than this is
	// read as now.
	futureSlack = 10 * time.Minute
	// UTC offsets run from UTC-12 to UTC+14.
	minOffsetMinutes = -12 * 60
	maxOffsetMinutes = 14 * 60

	// DayLayout is how a day is written: the calendar date on the person's own clock.
	DayLayout      = "2006-01-02"
	minutesPerHour = 60
)

// earliest is the oldest end a Run can report.
var earliest = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

var (
	// ErrInvalid is a record or a read Acorn will not take.
	ErrInvalid = errors.New("invalid run")
	// ErrNotFound is a Run (or the image of one) this account does not have.
	ErrNotFound = errors.New("run not found")
	// ErrTooLarge is an image over config.MaxRunScreenshotBytes.
	ErrTooLarge = errors.New("screenshot is too large")
	// ErrNotJPEG is an image that is not a JPEG.
	ErrNotJPEG = errors.New("screenshot must be a JPEG")
)

// jpegMagic opens every JPEG file.
var jpegMagic = []byte{0xFF, 0xD8, 0xFF}

// Record is what the extension reports when a Run ends with the application sent.
type Record struct {
	// RecordID is made once per record and kept by the sender until it is stored: sending it
	// again counts once.
	RecordID string `json:"recordId"`
	// RunID is the Run's id in the extension's Logs tab.
	RunID string `json:"runId"`
	// URL is the page the Run started on, the link of the job.
	URL   string `json:"url"`
	Title string `json:"title"`
	// EndedAt is when the application was confirmed sent (ms since epoch).
	EndedAt int64 `json:"endedAt"`
	// UTCOffsetMinutes is the person's clock at EndedAt, minutes east of UTC. The day the Run
	// counts for is the calendar day on that clock.
	UTCOffsetMinutes int `json:"utcOffsetMinutes"`
	// DurationMs is how long the Run worked, not counting the time it waited on the person.
	DurationMs int64 `json:"durationMs"`
	// CostNanos is what the models cost, in nanodollars (like acorn_ai_usage).
	CostNanos    int64 `json:"costNanos"`
	Steps        int   `json:"steps"`
	ModelCalls   int   `json:"modelCalls"`
	ScreenChecks int   `json:"screenChecks"`
}

// Entry is one Run that sent an application, as it is stored.
type Entry struct {
	ID        string `bson:"_id"`
	AccountID string `bson:"accountId"`
	RecordID  string `bson:"recordId"`
	RunID     string `bson:"runId"`
	URL       string `bson:"url"`
	Title     string `bson:"title"`
	// Day is the calendar date on the person's clock when the Run ended, and Minute the minutes
	// after midnight on it, so a page shows the time the person saw without a time zone.
	Day           string    `bson:"day"`
	Minute        int       `bson:"minute"`
	EndedAt       time.Time `bson:"endedAt"`
	DurationMs    int64     `bson:"durationMs"`
	CostNanos     int64     `bson:"costNanos"`
	Steps         int       `bson:"steps"`
	ModelCalls    int       `bson:"modelCalls"`
	ScreenChecks  int       `bson:"screenChecks"`
	ClientVersion string    `bson:"clientVersion"`
	CreatedAt     time.Time `bson:"createdAt"`
	// ScreenshotAt is when the full-page image was stored; zero without one.
	ScreenshotAt time.Time `bson:"screenshotAt,omitempty"`
}

// Day is the Runs of one calendar day.
type Day struct {
	Day        string `json:"day"`
	Count      int    `json:"count"`
	DurationMs int64  `json:"durationMs"`
	CostNanos  int64  `json:"costNanos"`
}

// backend is where the rows live: MongoDB in production, memory in tests.
type backend interface {
	// insert stores the entry and returns the stored one with whether it was new: a record already
	// stored for this account is left as it was and returned.
	insert(ctx context.Context, entry Entry) (Entry, bool, error)
	// putScreenshot stores the image of the account's Run, replacing one already there, and marks
	// the Run with it. ErrNotFound when the account has no such Run.
	putScreenshot(ctx context.Context, accountID, runID string, data []byte, at time.Time) error
	// screenshot is the image of the account's Run. ErrNotFound without one.
	screenshot(ctx context.Context, accountID, runID string) ([]byte, error)
	// daily sums the account's Runs by day, for the days from..to (both inclusive), oldest first.
	daily(ctx context.Context, accountID, from, to string) ([]Day, error)
	// recent is the account's newest Runs, newest first.
	recent(ctx context.Context, accountID string, limit int) ([]Entry, error)
}

// Store is the account's Runs that sent an application.
type Store struct {
	db  backend
	now func() time.Time
}

// Record stores a completed Run for the account and returns its id. It reports whether the Run
// was new: the same record sent again (a retry after the answer was lost) is stored once, and
// answers the id of the Run already stored.
func (s *Store) Record(ctx context.Context, accountID string, in Record, clientVersion string) (string, bool, error) {
	entry, err := newEntry(accountID, in, clientVersion, s.now())
	if err != nil {
		return "", false, err
	}
	stored, created, err := s.db.insert(ctx, entry)
	return stored.ID, created, err
}

// SetScreenshot keeps the full-page JPEG of the account's Run, replacing an earlier one.
func (s *Store) SetScreenshot(ctx context.Context, accountID, runID string, data []byte) error {
	switch {
	case accountID == "" || !plainKey(runID):
		return ErrNotFound
	case len(data) > config.MaxRunScreenshotBytes:
		return ErrTooLarge
	case !bytes.HasPrefix(data, jpegMagic):
		return ErrNotJPEG
	}
	return s.db.putScreenshot(ctx, accountID, runID, data, s.now().UTC())
}

// Screenshot is the JPEG of the account's Run. ErrNotFound when it has none or it has expired.
func (s *Store) Screenshot(ctx context.Context, accountID, runID string) ([]byte, error) {
	if accountID == "" || !plainKey(runID) {
		return nil, ErrNotFound
	}
	return s.db.screenshot(ctx, accountID, runID)
}

// Daily is the account's Runs summed by day, from..to inclusive (both `YYYY-MM-DD`), oldest
// first. Days with no Run are left out.
func (s *Store) Daily(ctx context.Context, accountID, from, to string) ([]Day, error) {
	start, startErr := time.Parse(DayLayout, from)
	end, endErr := time.Parse(DayLayout, to)
	if startErr != nil || endErr != nil || end.Before(start) || end.Sub(start) > MaxDailyDays*24*time.Hour {
		return nil, fmt.Errorf("%w: from and to must be days like 2026-10-21, from first and at most %d days apart", ErrInvalid, MaxDailyDays)
	}
	if accountID == "" {
		return nil, nil
	}
	return s.db.daily(ctx, accountID, from, to)
}

// Recent is the account's newest Runs, newest first. A limit outside 1..MaxRecent is the default.
func (s *Store) Recent(ctx context.Context, accountID string, limit int) ([]Entry, error) {
	if accountID == "" {
		return nil, nil
	}
	if limit < 1 || limit > MaxRecent {
		limit = DefaultRecent
	}
	return s.db.recent(ctx, accountID, limit)
}

// newEntry checks a record and turns it into the row to store. What describes the job (its
// link, its title) is cleaned rather than refused: a Run that did send the application is
// counted even when its page's address is not one a person can open.
func newEntry(accountID string, in Record, clientVersion string, now time.Time) (Entry, error) {
	switch {
	case accountID == "":
		return Entry{}, fmt.Errorf("%w: no account", ErrInvalid)
	case !plainKey(in.RecordID):
		return Entry{}, fmt.Errorf("%w: recordId is required", ErrInvalid)
	case in.UTCOffsetMinutes < minOffsetMinutes || in.UTCOffsetMinutes > maxOffsetMinutes:
		return Entry{}, fmt.Errorf("%w: utcOffsetMinutes is out of range", ErrInvalid)
	case in.DurationMs < 0 || in.DurationMs > maxDurationMs:
		return Entry{}, fmt.Errorf("%w: durationMs is out of range", ErrInvalid)
	case in.CostNanos < 0 || in.CostNanos > maxCostNanos:
		return Entry{}, fmt.Errorf("%w: costNanos is out of range", ErrInvalid)
	case !inRange(in.Steps) || !inRange(in.ModelCalls) || !inRange(in.ScreenChecks):
		return Entry{}, fmt.Errorf("%w: steps, modelCalls and screenChecks are out of range", ErrInvalid)
	}
	ended := time.UnixMilli(in.EndedAt).UTC()
	if ended.Before(earliest) {
		return Entry{}, fmt.Errorf("%w: endedAt is out of range", ErrInvalid)
	}
	if ended.After(now.Add(futureSlack)) {
		ended = now.UTC()
	}
	local := ended.Add(time.Duration(in.UTCOffsetMinutes) * time.Minute)
	return Entry{
		ID:            bson.NewObjectID().Hex(),
		AccountID:     accountID,
		RecordID:      in.RecordID,
		RunID:         clip(strings.TrimSpace(in.RunID), maxKey),
		URL:           cleanURL(in.URL),
		Title:         clip(strings.Join(strings.Fields(in.Title), " "), MaxTitle),
		Day:           local.Format(DayLayout),
		Minute:        local.Hour()*minutesPerHour + local.Minute(),
		EndedAt:       ended,
		DurationMs:    in.DurationMs,
		CostNanos:     in.CostNanos,
		Steps:         in.Steps,
		ModelCalls:    in.ModelCalls,
		ScreenChecks:  in.ScreenChecks,
		ClientVersion: clip(strings.TrimSpace(clientVersion), maxKey),
		CreatedAt:     now.UTC(),
	}, nil
}

func inRange(count int) bool { return count >= 0 && count <= maxCount }

// plainKey reports whether an id is a non-empty run of letters, digits, '-' and '_'.
func plainKey(key string) bool {
	if key == "" || len(key) > maxKey {
		return false
	}
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}

// cleanURL is the page's address as a person can open it: http or https only, without the
// fragment or any sign-in embedded in it. An address that is not that, or is too long to keep
// whole, is "": the website draws a link only for an address that is there.
func cleanURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	parsed.Fragment = ""
	parsed.User = nil
	cleaned := parsed.String()
	if len(cleaned) > MaxURL {
		return ""
	}
	return cleaned
}

// clip cuts text to at most max runes without splitting one.
func clip(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return string([]rune(text)[:max])
}
