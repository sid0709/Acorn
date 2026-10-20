package applicant

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ServerTimingHeader is the standard header a response uses to say where its time went.
const ServerTimingHeader = "Server-Timing"

// upstreamPrefix marks the backend's own timing entries when the agent passes them on.
const upstreamPrefix = "backend-"

// Timing is what the backend calls made under one context cost: the wait for the backend to
// answer, the time to read what it sent, the bytes, and the backend's own account of its time.
// A request's handler puts one on the context, then sends it on as Server-Timing, so the
// person's side can split a slow call into the agent's hop and the backend's.
type Timing struct {
	mu       sync.Mutex
	calls    int
	wait     time.Duration
	read     time.Duration
	bytes    int
	upstream string
}

type timingKey struct{}

// WithTiming returns a context whose backend calls are counted in the returned Timing.
func WithTiming(ctx context.Context) (context.Context, *Timing) {
	timing := &Timing{}
	return context.WithValue(ctx, timingKey{}, timing), timing
}

func record(ctx context.Context, wait, read time.Duration, bytes int, upstream string) {
	timing, ok := ctx.Value(timingKey{}).(*Timing)
	if !ok {
		return
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	timing.calls++
	timing.wait += wait
	timing.read += read
	timing.bytes += bytes
	timing.upstream = upstream
}

func millis(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }

// ServerTiming is the header value: the agent's wait on the backend and its read, then the
// backend's own entries (what its last answer said) under a backend- prefix.
func (t *Timing) ServerTiming() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.calls == 0 {
		return ""
	}
	parts := []string{
		fmt.Sprintf("%swait;dur=%.1f;desc=\"calls=%d\"", upstreamPrefix, millis(t.wait), t.calls),
		fmt.Sprintf("%sread;dur=%.1f;desc=\"bytes=%d\"", upstreamPrefix, millis(t.read), t.bytes),
	}
	for _, entry := range strings.Split(t.upstream, ", ") {
		if entry = strings.TrimSpace(entry); entry != "" {
			parts = append(parts, upstreamPrefix+"in-"+entry)
		}
	}
	return strings.Join(parts, ", ")
}
