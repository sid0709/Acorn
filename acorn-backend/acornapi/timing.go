package acornapi

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Server-Timing metric names. A browser lists them under a response's Timing tab and in
// PerformanceResourceTiming.serverTiming, so a slow claim can be traced to its step.
const (
	timingList     = "list"
	timingCounts   = "counts"
	timingClaim    = "claim"
	timingMessages = "messages"
	timingImage    = "image"
	timingTotal    = "total"
)

// timing times the steps of one request for the Server-Timing header.
type timing struct {
	started, last time.Time
	parts         []string
}

func startTiming() *timing {
	now := time.Now()
	return &timing{started: now, last: now}
}

// step records the time since the last step (or the start) under name.
func (t *timing) step(name string) {
	now := time.Now()
	t.parts = append(t.parts, metric(name, now.Sub(t.last)))
	t.last = now
}

// apply writes the header; call it before the first byte of the body.
func (t *timing) apply(w http.ResponseWriter) {
	parts := append(t.parts[:len(t.parts):len(t.parts)], metric(timingTotal, time.Since(t.started)))
	w.Header().Set("Server-Timing", strings.Join(parts, ", "))
}

func metric(name string, d time.Duration) string {
	return fmt.Sprintf("%s;dur=%.1f", name, float64(d.Microseconds())/1000)
}
