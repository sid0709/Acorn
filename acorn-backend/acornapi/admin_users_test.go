package acornapi

import (
	"testing"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
)

func TestAccountRowIncludesDeactivatedAt(t *testing.T) {
	active := accountRow(account.AccountRow{
		ID: "a", Name: "Ada", Email: "ada@example.com",
		CreatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
	})
	if _, ok := active["deactivatedAt"]; ok {
		t.Fatal("active account included deactivatedAt")
	}

	at := time.Date(2026, 10, 8, 15, 4, 5, 0, time.FixedZone("CDT", -5*60*60))
	gone := accountRow(account.AccountRow{
		ID: "a", Name: "Ada", Email: "ada@example.com",
		CreatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), DeactivatedAt: at,
	})
	got, ok := gone["deactivatedAt"].(time.Time)
	if !ok || !got.Equal(at.UTC()) {
		t.Fatalf("deactivatedAt = %#v", gone["deactivatedAt"])
	}
}
