package acornapi

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// serverTimingHeader is the standard header a response uses to say where its time went.
const serverTimingHeader = "Server-Timing"

// stepTimer times the steps of one request in turn and reports them as Server-Timing, so the
// caller (acorn-agent, and through it the extension's log) can tell a slow file read from a slow
// network.
type stepTimer struct {
	last    time.Time
	entries []string
}

func newStepTimer() *stepTimer { return &stepTimer{last: time.Now()} }

// step ends the step that has been running since the last one, under name; desc is optional.
func (t *stepTimer) step(name, desc string) {
	now := time.Now()
	entry := fmt.Sprintf("%s;dur=%.1f", name, float64(now.Sub(t.last))/float64(time.Millisecond))
	if desc != "" {
		entry += fmt.Sprintf(";desc=%q", desc)
	}
	t.entries = append(t.entries, entry)
	t.last = now
}

// write sets the header; call it before the first byte of the answer.
func (t *stepTimer) write(w http.ResponseWriter) {
	if len(t.entries) > 0 {
		w.Header().Set(serverTimingHeader, strings.Join(t.entries, ", "))
	}
}
