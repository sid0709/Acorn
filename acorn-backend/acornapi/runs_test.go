package acornapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/sid0709/acorn/acorn-backend/account"
)

// sentRun is the body the extension posts when a Run ends with the application sent.
func sentRun(recordID string, endedAt time.Time, offset int) string {
	return fmt.Sprintf(`{"recordId":%q,"runId":"ab12cd34","url":"https://boards.example.com/acme/jobs/42?gh_jid=42#apply",`+
		`"title":"Senior Engineer","endedAt":%d,"utcOffsetMinutes":%d,"durationMs":93000,"costNanos":21500000,`+
		`"steps":19,"modelCalls":21,"screenChecks":3}`, recordID, endedAt.UnixMilli(), offset)
}

type runsBody struct {
	Success  bool `json:"success"`
	Recorded bool `json:"recorded"`
	Runs     []struct {
		ID         string `json:"id"`
		URL        string `json:"url"`
		Title      string `json:"title"`
		Day        string `json:"day"`
		Minute     int    `json:"minute"`
		DurationMs int64  `json:"durationMs"`
		CostNanos  int64  `json:"costNanos"`
		Steps      int    `json:"steps"`
	} `json:"runs"`
	Days []struct {
		Day        string `json:"day"`
		Count      int    `json:"count"`
		DurationMs int64  `json:"durationMs"`
		CostNanos  int64  `json:"costNanos"`
	} `json:"days"`
}

func readRuns(t *testing.T, handler http.Handler, path, token string) (int, runsBody) {
	t.Helper()
	rec := call(handler, "GET", path, "", bearer(token), "")
	var body runsBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("%s = %d %s", path, rec.Code, rec.Body)
	}
	return rec.Code, body
}

func TestRunsNeedASignedInPerson(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	for _, route := range [][2]string{
		{"POST", "/acorn/runs"},
		{"GET", "/acorn/runs"},
		{"GET", "/acorn/runs/daily?from=2026-10-01&to=2026-10-21"},
	} {
		if rec := call(handler, route[0], route[1], "", nil, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a session = %d", route[0], route[1], rec.Code)
		}
	}
}

func TestACompletedRunIsKeptOnceWhateverHowOftenItIsSent(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	body := sentRun("rec-1", time.Now().Add(-time.Minute), 0)

	first := call(handler, "POST", "/acorn/runs", body, bearer("hunter"), "")
	if first.Code != http.StatusCreated {
		t.Fatalf("first send = %d %s", first.Code, first.Body)
	}
	again := call(handler, "POST", "/acorn/runs", body, bearer("hunter"), "")
	var answer runsBody
	if err := json.Unmarshal(again.Body.Bytes(), &answer); err != nil || again.Code != http.StatusOK || answer.Recorded {
		t.Fatalf("a repeat = %d %s, want 200 and recorded:false", again.Code, again.Body)
	}

	code, listed := readRuns(t, handler, "/acorn/runs", "hunter")
	if code != http.StatusOK || len(listed.Runs) != 1 {
		t.Fatalf("runs = %d %+v, want one", code, listed.Runs)
	}
	got := listed.Runs[0]
	if got.URL != "https://boards.example.com/acme/jobs/42?gh_jid=42" || got.Title != "Senior Engineer" ||
		got.DurationMs != 93000 || got.CostNanos != 21_500_000 || got.Steps != 19 || got.ID == "" {
		t.Fatalf("run = %+v", got)
	}
}

func TestRunsAreCountedByTheDayOnThePersonsClock(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	// 02:30 UTC two days ago: the evening before, in California.
	ended := time.Now().UTC().Add(-48 * time.Hour).Truncate(24 * time.Hour).Add(2*time.Hour + 30*time.Minute)
	call(handler, "POST", "/acorn/runs", sentRun("rec-a", ended, -7*60), bearer("hunter"), "")
	call(handler, "POST", "/acorn/runs", sentRun("rec-b", ended.Add(time.Minute), -7*60), bearer("hunter"), "")

	westDay := ended.Add(-7 * time.Hour).Format("2006-01-02")
	from := ended.Add(-10 * 24 * time.Hour).Format("2006-01-02")
	to := time.Now().UTC().Add(24 * time.Hour).Format("2006-01-02")
	code, body := readRuns(t, handler, "/acorn/runs/daily?from="+from+"&to="+to, "hunter")
	if code != http.StatusOK || len(body.Days) != 1 {
		t.Fatalf("days = %d %+v, want one day", code, body.Days)
	}
	day := body.Days[0]
	if day.Day != westDay || day.Count != 2 || day.DurationMs != 186000 || day.CostNanos != 43_000_000 {
		t.Fatalf("day = %+v, want %s with 2 runs", day, westDay)
	}
}

func TestOneAccountNeverSeesAnothersRuns(t *testing.T) {
	handler, accounts := newTestServer(t, fakeModel{})
	accounts.users["rival"] = account.User{ID: "u2", Name: "Casey", Email: "c@example.com"}
	call(handler, "POST", "/acorn/runs", sentRun("rec-1", time.Now().Add(-time.Minute), 0), bearer("hunter"), "")

	_, theirs := readRuns(t, handler, "/acorn/runs", "rival")
	if len(theirs.Runs) != 0 {
		t.Fatalf("another account read %+v", theirs.Runs)
	}
	today := time.Now().UTC().Format("2006-01-02")
	_, days := readRuns(t, handler, "/acorn/runs/daily?from="+today+"&to="+today, "rival")
	if len(days.Days) != 0 {
		t.Fatalf("another account read %+v", days.Days)
	}
}

func TestARunThatCannotBeTrustedIsRefused(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	for name, body := range map[string]string{
		"no body":      ``,
		"no record id": `{"endedAt":1790000000000}`,
		"not json":     `not json`,
		"bad offset":   sentRun("rec-1", time.Now().Add(-time.Minute), 24*60),
	} {
		if rec := call(handler, "POST", "/acorn/runs", body, bearer("hunter"), ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s = %d %s, want 400", name, rec.Code, rec.Body)
		}
	}
	_, listed := readRuns(t, handler, "/acorn/runs", "hunter")
	if len(listed.Runs) != 0 {
		t.Fatalf("a refused run was kept: %+v", listed.Runs)
	}
}

func TestTheDaysNeedARealSpan(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	for _, path := range []string{
		"/acorn/runs/daily",
		"/acorn/runs/daily?from=2026-10-21&to=2026-10-01",
		"/acorn/runs/daily?from=2020-01-01&to=2026-10-21",
		"/acorn/runs/daily?from=today&to=tomorrow",
	} {
		if rec := call(handler, "GET", path, "", bearer("hunter"), ""); rec.Code != http.StatusBadRequest {
			t.Errorf("GET %s = %d %s, want 400", path, rec.Code, rec.Body)
		}
	}
}

func TestAnEmptyAccountReadsEmptyListsNotNull(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	list := call(handler, "GET", "/acorn/runs", "", bearer("hunter"), "")
	days := call(handler, "GET", "/acorn/runs/daily?from=2026-10-01&to=2026-10-21", "", bearer("hunter"), "")
	for name, rec := range map[string]string{"runs": list.Body.String(), "days": days.Body.String()} {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal([]byte(rec), &raw); err != nil || string(raw[name]) != "[]" {
			t.Errorf("%s = %s, want []", name, rec)
		}
	}
}
