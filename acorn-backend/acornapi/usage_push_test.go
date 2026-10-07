package acornapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/acornapi/gateway"
	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

type fakeUsageStore struct {
	entry aiusage.Entry
	err   error
	got   *aiusage.CallContext
}

func (f fakeUsageStore) Record(_ context.Context, call aiusage.CallContext, _ openai.Usage) (aiusage.Entry, error) {
	if f.got != nil {
		*f.got = call
	}
	return f.entry, f.err
}

var testCall = aiusage.CallContext{AccountID: "acct", TabKey: "tab-key-1"}

type pushed struct {
	account, event string
	payload        any
}

type fakeEmitter struct{ events []pushed }

func (f *fakeEmitter) EmitToAccount(accountID, event string, payload any) {
	f.events = append(f.events, pushed{accountID, event, payload})
}

func TestRecordAndPushSendsTheEntryToItsTab(t *testing.T) {
	emitter := &fakeEmitter{}
	store := fakeUsageStore{entry: aiusage.Entry{ID: "u1", Model: "jev", CostNanos: 42, Priced: true}}
	recordAndPush(store, emitter, testCall, openai.Usage{})
	if len(emitter.events) != 1 {
		t.Fatalf("events = %d, want 1", len(emitter.events))
	}
	got := emitter.events[0]
	payload := got.payload.(map[string]any)
	row := payload["entry"].(map[string]any)
	if got.account != "acct" || got.event != gateway.UsageRecordedEvent || payload["tab"] != "tab-key-1" ||
		row["id"] != "u1" || row["costNanos"] != int64(42) {
		t.Fatalf("pushed %+v", got)
	}
}

func TestRecordAndPushSkipsWhatWasNotKept(t *testing.T) {
	emitter := &fakeEmitter{}
	recordAndPush(fakeUsageStore{}, emitter, testCall, openai.Usage{})
	recordAndPush(fakeUsageStore{err: errors.New("db down")}, emitter, testCall, openai.Usage{})
	if len(emitter.events) != 0 {
		t.Fatalf("events = %+v, want none", emitter.events)
	}
}

func TestCallContextReadsRouteClientAndSupport(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/acorn/qa", nil)
	r.Pattern = "POST /acorn/qa"
	r.Header.Set(tabHeader, "tab-key-1")
	r.Header.Set(clientHeader, "extension/1.9.0")
	held := &requestSession{supportBy: "admin@example.com"}
	r = r.WithContext(context.WithValue(r.Context(), requestSessionKey{}, held))

	got := callContext(r, "acct")
	want := aiusage.CallContext{
		AccountID: "acct", TabKey: "tab-key-1", Route: "POST /acorn/qa", Feature: featureAsk,
		Client: "extension", ClientVersion: "1.9.0", SupportBy: "admin@example.com",
	}
	if got != want {
		t.Fatalf("callContext = %+v, want %+v", got, want)
	}
}

func TestClientFromDropsJunk(t *testing.T) {
	cases := map[string][2]string{
		"web":             {"web", ""},
		"Extension/1.9.0": {"extension", "1.9.0"},
		"ext ension/1.0":  {"", "1.0"},
		"web/<script>":    {"web", ""},
		"":                {"", ""},
	}
	for raw, want := range cases {
		name, version := clientFrom(raw)
		if name != want[0] || version != want[1] {
			t.Errorf("clientFrom(%q) = %q, %q; want %q, %q", raw, name, version, want[0], want[1])
		}
	}
}

func TestEveryModelRouteHasAFeature(t *testing.T) {
	for pattern, feature := range routeFeatures {
		if featureForRoute(pattern) != feature || feature == "" {
			t.Errorf("route %q has no feature", pattern)
		}
	}
	if featureForRoute("GET /acorn/health") != "GET /acorn/health" {
		t.Error("unknown routes should fall back to their pattern")
	}
}
