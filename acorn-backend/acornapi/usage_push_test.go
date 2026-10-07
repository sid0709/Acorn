package acornapi

import (
	"context"
	"errors"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/acornapi/gateway"
	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

type fakeUsageStore struct {
	entry aiusage.Entry
	err   error
}

func (f fakeUsageStore) Record(context.Context, string, string, openai.Usage) (aiusage.Entry, error) {
	return f.entry, f.err
}

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
	recordAndPush(store, emitter, "acct", "tab-key-1", openai.Usage{})
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
	recordAndPush(fakeUsageStore{}, emitter, "acct", "tab-key-1", openai.Usage{})
	recordAndPush(fakeUsageStore{err: errors.New("db down")}, emitter, "acct", "tab-key-1", openai.Usage{})
	if len(emitter.events) != 0 {
		t.Fatalf("events = %+v, want none", emitter.events)
	}
}
