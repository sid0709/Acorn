package support

import (
	"testing"
	"time"
)

func TestUnreadForIsTheOtherSidesLatestMessage(t *testing.T) {
	read := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	later := read.Add(time.Minute)
	cases := []struct {
		name   string
		claim  Claim
		reader string
		want   bool
	}{
		{"admin replied after user read", Claim{LastMessageBy: AuthorAdmin, LastMessageAt: later, UserReadAt: read}, AuthorUser, true},
		{"user read after admin replied", Claim{LastMessageBy: AuthorAdmin, LastMessageAt: read, UserReadAt: later}, AuthorUser, false},
		{"own message is never unread", Claim{LastMessageBy: AuthorUser, LastMessageAt: later}, AuthorUser, false},
		{"admin sees a new report", Claim{LastMessageBy: AuthorUser, LastMessageAt: later, AdminReadAt: read}, AuthorAdmin, true},
		{"no messages", Claim{}, AuthorAdmin, false},
	}
	for _, tc := range cases {
		if got := tc.claim.UnreadFor(tc.reader); got != tc.want {
			t.Errorf("%s: UnreadFor = %v, want %v", tc.name, got, tc.want)
		}
	}
}
