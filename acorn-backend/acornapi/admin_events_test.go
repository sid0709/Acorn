package acornapi

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sid0709/acorn/acorn-backend/acornapi/feed"
	"github.com/sid0709/acorn/acorn-backend/acornapi/gateway"
	"github.com/sid0709/acorn/acorn-backend/support"
)

const streamTestTimeout = 5 * time.Second

// readEvent reads one SSE block and returns its event name and data line.
func readEvent(t *testing.T, lines *bufio.Scanner) (string, string) {
	t.Helper()
	var name, data string
	for lines.Scan() {
		line := lines.Text()
		switch {
		case line == "":
			if name != "" {
				return name, data
			}
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		}
	}
	t.Fatalf("stream ended: %v", lines.Err())
	return "", ""
}

func TestServeEventsStreamsReadyThenPublishedClaimChanges(t *testing.T) {
	s := &Server{staff: feed.New()}
	subscribed := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		events, cancel := s.staff.Subscribe()
		defer cancel()
		close(subscribed)
		serveEvents(w, r, events)
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), streamTestTimeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if got := res.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q", got)
	}
	lines := bufio.NewScanner(res.Body)
	if name, _ := readEvent(t, lines); name != eventsReady {
		t.Fatalf("first event = %q, want %q", name, eventsReady)
	}

	<-subscribed
	claim := support.Claim{ID: "c1", AccountID: "acct"}
	s.publishStaffMessage(claim, map[string]any{"id": "m1", "body": "still broken"})
	name, data := readEvent(t, lines)
	if name != gateway.SupportMessageEvent || !strings.Contains(data, `"id":"m1"`) ||
		!strings.Contains(data, `"id":"c1"`) {
		t.Fatalf("event %q data %s", name, data)
	}

	s.publishStaffClaim(claim)
	if name, _ := readEvent(t, lines); name != gateway.SupportClaimEvent {
		t.Fatalf("event = %q, want %q", name, gateway.SupportClaimEvent)
	}
}
