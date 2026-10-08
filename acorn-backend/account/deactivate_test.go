package account

import (
	"testing"
	"time"
)

func TestAccountRowDeactivated(t *testing.T) {
	if (AccountRow{}).Deactivated() {
		t.Fatal("an account with no deactivatedAt is active")
	}
	row := AccountRow{DeactivatedAt: time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)}
	if !row.Deactivated() {
		t.Fatal("an account with deactivatedAt is deactivated")
	}
}
