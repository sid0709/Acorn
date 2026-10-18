package killswitch

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoadDefaultsReadsEnv(t *testing.T) {
	t.Setenv(envJobImports, "")
	t.Setenv(envAcornAI, "on")
	t.Setenv(envScoutSubmissions, "0")
	t.Setenv(envCheckout, "disabled")
	got := LoadDefaults()
	if got[ScoutSubmissions] || got[Checkout] {
		t.Fatalf("off switches still on: %+v", got)
	}
	if !got[JobImports] || !got[AcornAI] {
		t.Fatalf("unset/on switches off: %+v", got)
	}
}

func TestMemoryOverrideBeatsEnv(t *testing.T) {
	ctx := context.Background()
	mem := NewMemory(Defaults{JobImports: true, ScoutSubmissions: false})
	if !mem.Enabled(ctx, JobImports) {
		t.Fatal("job_imports env default should be on")
	}
	if mem.Enabled(ctx, ScoutSubmissions) {
		t.Fatal("scout env default should be off")
	}
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	result, err := mem.Set(ctx, JobImports, false, "roosebelt", "incident", now)
	if err != nil {
		t.Fatal(err)
	}
	if result.State.Enabled || result.State.Source != sourceOverride || result.AuditID == "" {
		t.Fatalf("set = %+v", result)
	}
	if mem.Enabled(ctx, JobImports) {
		t.Fatal("mongo override should turn job_imports off")
	}
	list, err := mem.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != len(Names) {
		t.Fatalf("list len = %d", len(list))
	}
	audits := mem.Audits()
	if len(audits) != 1 || audits[0].Action != auditActionDisable || audits[0].SubjectID != string(JobImports) {
		t.Fatalf("audits = %+v", audits)
	}
}

func TestMemoryRejectsUnknownName(t *testing.T) {
	_, err := NewMemory(nil).Set(context.Background(), Name("nope"), false, "admin", "", time.Time{})
	if !errors.Is(err, ErrUnknown) {
		t.Fatalf("err = %v", err)
	}
}

func TestCacheReusesFetchUntilTTL(t *testing.T) {
	calls := 0
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	store := &Store{
		defaults: complete(Defaults{JobImports: true}),
		cacheTTL: time.Second,
		now:      func() time.Time { return now },
		fetch: func(context.Context) (map[Name]document, error) {
			calls++
			return map[Name]document{JobImports: {ID: string(JobImports), Enabled: false}}, nil
		},
	}
	ctx := context.Background()
	if store.Enabled(ctx, JobImports) {
		t.Fatal("override should disable signup")
	}
	if store.Enabled(ctx, JobImports) {
		t.Fatal("second read should still be off")
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls)
	}
	now = now.Add(2 * time.Second)
	if store.Enabled(ctx, JobImports) {
		t.Fatal("after TTL should still be off")
	}
	if calls != 2 {
		t.Fatalf("fetch calls after TTL = %d, want 2", calls)
	}
}

func TestFetchErrorKeepsStaleCache(t *testing.T) {
	calls := 0
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	store := &Store{
		defaults: complete(Defaults{JobImports: true}),
		cacheTTL: time.Second,
		now:      func() time.Time { return now },
		fetch: func(context.Context) (map[Name]document, error) {
			calls++
			if calls == 1 {
				return map[Name]document{JobImports: {ID: string(JobImports), Enabled: false}}, nil
			}
			return nil, errors.New("mongo down")
		},
	}
	ctx := context.Background()
	if store.Enabled(ctx, JobImports) {
		t.Fatal("first read")
	}
	now = now.Add(2 * time.Second)
	if store.Enabled(ctx, JobImports) {
		t.Fatal("stale cache should keep signup off")
	}
}

func TestFetchErrorWithoutCacheUsesEnv(t *testing.T) {
	store := &Store{
		defaults: complete(Defaults{JobImports: true}),
		cacheTTL: time.Second,
		fetch: func(context.Context) (map[Name]document, error) {
			return nil, errors.New("mongo down")
		},
	}
	if !store.Enabled(context.Background(), JobImports) {
		t.Fatal("env default should stay on when mongo has never answered")
	}
}

func TestWriteDisabledAndGuard(t *testing.T) {
	mem := NewMemory(Defaults{JobImports: false})
	rec := httptest.NewRecorder()
	WriteDisabled(rec, JobImports)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "Job imports") {
		t.Fatalf("disabled = %d %s", rec.Code, rec.Body.String())
	}

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	blocked := httptest.NewRecorder()
	Guard(mem, JobImports, inner).ServeHTTP(blocked, httptest.NewRequest(http.MethodPost, "/v1/admin/job-imports", nil))
	if blocked.Code != http.StatusServiceUnavailable {
		t.Fatalf("guard off = %d", blocked.Code)
	}
	open := httptest.NewRecorder()
	Guard(nil, JobImports, inner).ServeHTTP(open, httptest.NewRequest(http.MethodPost, "/v1/admin/job-imports", nil))
	if open.Code != http.StatusNoContent {
		t.Fatalf("nil switches = %d", open.Code)
	}
}

func TestCheck(t *testing.T) {
	ctx := context.Background()
	if err := Check(ctx, nil, Checkout); err != nil {
		t.Fatal(err)
	}
	mem := NewMemory(Defaults{Checkout: false})
	if err := Check(ctx, mem, Checkout); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v", err)
	}
}

func TestKnownAndMessage(t *testing.T) {
	if !Known(AcornAI) || Known("nope") {
		t.Fatal("Known")
	}
	if Message(JobImports) == "" || Message("x") == "" {
		t.Fatal("Message")
	}
}
