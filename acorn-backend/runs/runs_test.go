package runs

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)

func testStore() *Store {
	store := NewMemory()
	store.now = func() time.Time { return testNow }
	return store
}

// sent is a record for an application confirmed sent at `at`, on a clock `offset` minutes east of UTC.
func sent(id string, at time.Time, offset int) Record {
	return Record{
		RecordID:         id,
		RunID:            "ab12cd34",
		URL:              "https://boards.example.com/acme/jobs/42",
		Title:            "Senior Engineer",
		EndedAt:          at.UnixMilli(),
		UTCOffsetMinutes: offset,
		DurationMs:       93_000,
		CostNanos:        21_500_000,
		Steps:            19,
		ModelCalls:       21,
		ScreenChecks:     3,
	}
}

func record(t *testing.T, store *Store, account string, in Record) bool {
	t.Helper()
	created, err := store.Record(context.Background(), account, in, "1.98.0")
	if err != nil {
		t.Fatalf("Record(%+v) = %v", in, err)
	}
	return created
}

func TestTheSameRecordCountsOnce(t *testing.T) {
	store := testStore()
	in := sent("rec-1", testNow.Add(-time.Minute), 0)
	if !record(t, store, "acct", in) {
		t.Fatal("the first record was not new")
	}
	if record(t, store, "acct", in) {
		t.Fatal("the same record sent again was counted again")
	}
	days, err := store.Daily(context.Background(), "acct", "2026-10-21", "2026-10-21")
	if err != nil || len(days) != 1 || days[0].Count != 1 {
		t.Fatalf("days = %+v, %v; want one run", days, err)
	}
	// The same id on another account is another record: ids are only unique within an account.
	if !record(t, store, "other", in) {
		t.Fatal("another account's record was taken for a repeat")
	}
}

func TestADayIsTheCalendarDayOnThePersonsClock(t *testing.T) {
	// 02:30 UTC on the 22nd is 7:30 pm on the 21st in California and 11:30 am on the 22nd in Tokyo.
	at := time.Date(2026, 10, 22, 2, 30, 0, 0, time.UTC)
	later := at.Add(time.Hour)
	cases := []struct {
		offset int
		day    string
		minute int
	}{
		{-7 * 60, "2026-10-21", 19*60 + 30},
		{0, "2026-10-22", 2*60 + 30},
		{9 * 60, "2026-10-22", 11*60 + 30},
		{5*60 + 45, "2026-10-22", 8*60 + 15},
	}
	for _, c := range cases {
		entry, err := newEntry("acct", sent("rec", at, c.offset), "", later)
		if err != nil {
			t.Fatalf("offset %d: %v", c.offset, err)
		}
		if entry.Day != c.day || entry.Minute != c.minute {
			t.Errorf("offset %d: day %s minute %d, want %s %d", c.offset, entry.Day, entry.Minute, c.day, c.minute)
		}
		if !entry.EndedAt.Equal(at) {
			t.Errorf("offset %d: EndedAt = %v, want %v", c.offset, entry.EndedAt, at)
		}
	}
}

func TestAClockAheadOfOursIsReadAsNow(t *testing.T) {
	entry, err := newEntry("acct", sent("rec", testNow.Add(3*time.Hour), 0), "", testNow)
	if err != nil || !entry.EndedAt.Equal(testNow) {
		t.Fatalf("EndedAt = %v, %v; want now", entry.EndedAt, err)
	}
	// A few minutes of drift is no reason to move it.
	near := testNow.Add(5 * time.Minute)
	entry, err = newEntry("acct", sent("rec", near, 0), "", testNow)
	if err != nil || !entry.EndedAt.Equal(near) {
		t.Fatalf("EndedAt = %v, %v; want %v", entry.EndedAt, err, near)
	}
}

func TestARecordSentLongAfterItHappenedKeepsItsDay(t *testing.T) {
	week := testNow.Add(-8 * 24 * time.Hour)
	entry, err := newEntry("acct", sent("rec", week, 0), "", testNow)
	if err != nil || entry.Day != "2026-10-13" {
		t.Fatalf("day = %q, %v; want 2026-10-13", entry.Day, err)
	}
}

func TestWhatCannotBeTrustedIsRefused(t *testing.T) {
	good := sent("rec-1", testNow.Add(-time.Minute), -420)
	with := func(change func(*Record)) Record {
		in := good
		change(&in)
		return in
	}
	cases := map[string]Record{
		"no record id":        with(func(r *Record) { r.RecordID = "" }),
		"record id with junk": with(func(r *Record) { r.RecordID = "a b" }),
		"record id too long":  with(func(r *Record) { r.RecordID = strings.Repeat("a", maxKey+1) }),
		"offset too far west": with(func(r *Record) { r.UTCOffsetMinutes = -13 * 60 }),
		"offset too far east": with(func(r *Record) { r.UTCOffsetMinutes = 15 * 60 }),
		"negative time":       with(func(r *Record) { r.DurationMs = -1 }),
		"more than a day":     with(func(r *Record) { r.DurationMs = maxDurationMs + 1 }),
		"negative cost":       with(func(r *Record) { r.CostNanos = -1 }),
		"absurd cost":         with(func(r *Record) { r.CostNanos = maxCostNanos + 1 }),
		"negative steps":      with(func(r *Record) { r.Steps = -1 }),
		"absurd calls":        with(func(r *Record) { r.ModelCalls = maxCount + 1 }),
		"no end":              with(func(r *Record) { r.EndedAt = 0 }),
		"before Acorn":        with(func(r *Record) { r.EndedAt = earliest.Add(-time.Hour).UnixMilli() }),
	}
	for name, in := range cases {
		if _, err := newEntry("acct", in, "", testNow); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	if _, err := newEntry("", good, "", testNow); !errors.Is(err, ErrInvalid) {
		t.Errorf("no account: err = %v, want ErrInvalid", err)
	}
	if _, err := newEntry("acct", good, "", testNow); err != nil {
		t.Errorf("the good record was refused: %v", err)
	}
}

func TestOnlyALinkAPersonCanOpenIsKept(t *testing.T) {
	cases := map[string]string{
		"https://boards.example.com/acme/jobs/42?gh_jid=42#apply": "https://boards.example.com/acme/jobs/42?gh_jid=42",
		"  http://jobs.example.com/a  ":                           "http://jobs.example.com/a",
		"https://user:secret@jobs.example.com/a":                  "https://jobs.example.com/a",
		"javascript:alert(1)":                                     "",
		"data:text/html,<b>x</b>":                                 "",
		"ftp://jobs.example.com/a":                                "",
		"/relative/path":                                          "",
		"https:///nohost":                                         "",
		"":                                                        "",
		"https://jobs.example.com/" + strings.Repeat("a", MaxURL): "",
	}
	for raw, want := range cases {
		if got := cleanURL(raw); got != want {
			t.Errorf("cleanURL(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestADescriptionThatCannotBeKeptDoesNotLoseTheCount(t *testing.T) {
	in := sent("rec", testNow.Add(-time.Minute), 0)
	in.URL = "javascript:alert(1)"
	in.Title = "  Staff   Engineer \n\t at Acme  "
	store := testStore()
	if !record(t, store, "acct", in) {
		t.Fatal("a Run with an unusable link was not counted")
	}
	rows, err := store.Recent(context.Background(), "acct", 1)
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows = %+v, %v", rows, err)
	}
	if rows[0].URL != "" || rows[0].Title != "Staff Engineer at Acme" {
		t.Fatalf("row = %+v", rows[0])
	}
}

func TestATitleIsCutWithoutSplittingACharacter(t *testing.T) {
	long := strings.Repeat("é", MaxTitle+50)
	got := clip(long, MaxTitle)
	if len([]rune(got)) != MaxTitle || strings.ContainsRune(got, '�') {
		t.Fatalf("clip kept %d runes: %q", len([]rune(got)), got)
	}
}

func TestDailySumsOneAccountsRunsByDay(t *testing.T) {
	store := testStore()
	ctx := context.Background()
	at := func(day, clock string) time.Time {
		parsed, err := time.Parse("2006-01-02 15:04", day+" "+clock)
		if err != nil {
			t.Fatal(err)
		}
		return parsed
	}
	record(t, store, "acct", sent("a", at("2026-10-19", "09:00"), 0))
	record(t, store, "acct", sent("b", at("2026-10-21", "09:00"), 0))
	record(t, store, "acct", sent("c", at("2026-10-21", "15:00"), 0))
	record(t, store, "acct", sent("d", at("2026-10-01", "09:00"), 0)) // before the window
	record(t, store, "other", sent("e", at("2026-10-21", "10:00"), 0))

	days, err := store.Daily(ctx, "acct", "2026-10-15", "2026-10-21")
	if err != nil {
		t.Fatal(err)
	}
	want := []Day{
		{Day: "2026-10-19", Count: 1, DurationMs: 93_000, CostNanos: 21_500_000},
		{Day: "2026-10-21", Count: 2, DurationMs: 186_000, CostNanos: 43_000_000},
	}
	if len(days) != len(want) {
		t.Fatalf("days = %+v, want %+v", days, want)
	}
	for i := range want {
		if days[i] != want[i] {
			t.Errorf("day %d = %+v, want %+v", i, days[i], want[i])
		}
	}
}

func TestDailyRefusesWhatIsNotASpanOfDays(t *testing.T) {
	store := testStore()
	cases := [][2]string{
		{"", "2026-10-21"},
		{"2026-10-21", ""},
		{"yesterday", "today"},
		{"2026-10-21", "2026-10-20"},
		{"2025-01-01", "2026-10-21"},
	}
	for _, c := range cases {
		if _, err := store.Daily(context.Background(), "acct", c[0], c[1]); !errors.Is(err, ErrInvalid) {
			t.Errorf("Daily(%q, %q) err = %v, want ErrInvalid", c[0], c[1], err)
		}
	}
	if _, err := store.Daily(context.Background(), "acct", "2026-10-21", "2026-10-21"); err != nil {
		t.Errorf("a single day was refused: %v", err)
	}
}

func TestRecentIsNewestFirstAndLimited(t *testing.T) {
	store := testStore()
	ctx := context.Background()
	for i, id := range []string{"first", "second", "third"} {
		record(t, store, "acct", sent(id, testNow.Add(-time.Duration(3-i)*time.Hour), 0))
	}
	record(t, store, "other", sent("theirs", testNow.Add(-time.Minute), 0))

	rows, err := store.Recent(ctx, "acct", 2)
	if err != nil || len(rows) != 2 || rows[0].RecordID != "third" || rows[1].RecordID != "second" {
		t.Fatalf("rows = %+v, %v; want third then second", rows, err)
	}
	all, err := store.Recent(ctx, "acct", 0)
	if err != nil || len(all) != 3 {
		t.Fatalf("a limit of 0 should be the default: %d rows, %v", len(all), err)
	}
	if none, err := store.Recent(ctx, "", 5); err != nil || len(none) != 0 {
		t.Fatalf("no account should read nothing: %+v, %v", none, err)
	}
}
