package acornapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/acornapi/feed"
	"github.com/sid0709/OpenSeat/acorn-backend/acornapi/gateway"
	"github.com/sid0709/OpenSeat/acorn-backend/support"
)

const (
	// eventsHeartbeat keeps proxies from closing a quiet stream; nginx gives up after 60s.
	eventsHeartbeat = 25 * time.Second
	// eventsMaxAge ends a stream so the console reconnects and its admin session is checked again.
	eventsMaxAge = 15 * time.Minute
	// eventsRetry is how long the browser waits before reconnecting a dropped stream.
	eventsRetry = 2 * time.Second
	// eventsReady opens every stream; the console reloads on it to pick up what it missed.
	eventsReady = "ready"
	// eventsPreamble pads the first write: Safari holds a stream's first KB before delivering any.
	eventsPreamble = 2 << 10
)

// adminClaimEvents streams claim changes to the support console as Server-Sent Events:
// support:message for a new message from either side, support:claim for a new or changed claim.
func (s *Server) adminClaimEvents(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	events, cancel := s.staff.Subscribe()
	defer cancel()
	serveEvents(w, r, events)
}

// serveEvents writes events as Server-Sent Events until the client leaves, the channel
// closes, or the stream reaches eventsMaxAge.
func serveEvents(w http.ResponseWriter, r *http.Request, events <-chan feed.Event) {
	rc := http.NewResponseController(w)
	// The server's write timeout is for ordinary requests; this one stays open.
	if err := rc.SetWriteDeadline(time.Time{}); err != nil {
		slog.Warn("acorn admin events deadline", "error", err)
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if _, err := fmt.Fprintf(w, ":%s\nretry: %d\nevent: %s\ndata: {}\n\n",
		strings.Repeat(" ", eventsPreamble), eventsRetry.Milliseconds(), eventsReady); err != nil {
		return
	}
	if rc.Flush() != nil {
		return
	}

	heartbeat := time.NewTicker(eventsHeartbeat)
	defer heartbeat.Stop()
	maxAge := time.NewTimer(eventsMaxAge)
	defer maxAge.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-maxAge.C:
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
		case event, open := <-events:
			if !open {
				return
			}
			data, err := json.Marshal(event.Payload)
			if err != nil {
				slog.Error("acorn admin event", "event", event.Name, "error", err)
				continue
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Name, data); err != nil {
				return
			}
		}
		if rc.Flush() != nil {
			return
		}
	}
}

// eventSentAt is the payload field that stamps an event with the server's clock (Unix ms), so
// each side can record how long the push took to arrive. The same string is `sentAt` in
// @acorn/support-chat's ClaimPush.
const eventSentAt = "sentAt"

// eventCountsTimeout bounds counting the inbox for an event; without counts the console
// reloads its lists instead.
const eventCountsTimeout = 3 * time.Second

// staffPayload is what a console receives about a claim: the claim, its new counts, and the
// send time. The counts let it update every list in place instead of asking for them again.
func (s *Server) staffPayload(claim support.Claim) map[string]any {
	payload := map[string]any{"claim": claimRow(claim, support.AuthorAdmin), eventSentAt: time.Now().UnixMilli()}
	if s.claims == nil {
		return payload
	}
	ctx, cancel := context.WithTimeout(context.Background(), eventCountsTimeout)
	defer cancel()
	open, awaiting, err := s.claims.Counts(ctx)
	if err != nil {
		slog.Warn("acorn admin event counts", "error", err)
		return payload
	}
	payload["open"], payload["awaitingSupport"] = open, awaiting
	return payload
}

// publishStaffClaim tells every open console that a claim was filed.
func (s *Server) publishStaffClaim(claim support.Claim) {
	s.staff.Publish(gateway.SupportClaimEvent, s.staffPayload(claim))
}

// publishStaffMessage tells every open console about a new message on a claim.
func (s *Server) publishStaffMessage(claim support.Claim, message map[string]any) {
	payload := s.staffPayload(claim)
	payload["message"] = message
	s.staff.Publish(gateway.SupportMessageEvent, payload)
}
