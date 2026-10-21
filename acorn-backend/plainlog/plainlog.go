// Package plainlog writes the terminal log of Acorn's servers as short sentences a person can
// read, not as key=value records: one line per event, led by the time.
//
//	10:01:14  Run 42cd, step 9: looked at the page, asked the model (6.2s) and planned 3 actions.
//	10:03:23  Heads up: Reading the library of account ab12 timed out after 2m, so it loads on first use.
//
// The message is the sentence. Attributes are kept for the few facts that do not fit in it and
// are appended in brackets, so a call site that writes a good sentence adds none.
package plainlog

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// timeLayout is how a line starts: the time of day, which is what a person watching a run reads.
const timeLayout = "15:04:05"

// Prefixes of the lines that are not ordinary news. Debug lines carry none and are hidden unless
// the handler is asked for them.
const (
	warnPrefix  = "Heads up: "
	errorPrefix = "Problem: "
	// stackIndent marks the lines of a stack trace under the sentence it belongs to.
	stackIndent = "      "
)

// StackKey is the attribute that carries a stack trace: it is printed on its own lines under the
// sentence, not inside the brackets.
const StackKey = "stack"

// ErrorKey is the attribute that carries why something failed: it ends the sentence ("Could not
// save the profile: connection refused") instead of sitting in the brackets, so the many call
// sites that log a short message and an error read as one sentence without being rewritten.
const ErrorKey = "error"

// sentence is message with its first letter capitalised and, when there is a reason, the reason
// after a colon.
func sentence(message, reason string) string {
	message = strings.TrimSpace(message)
	if message != "" {
		first, size := utf8.DecodeRuneInString(message)
		message = string(unicode.ToUpper(first)) + message[size:]
	}
	if reason == "" {
		return message
	}
	if message == "" {
		return reason
	}
	return strings.TrimRight(message, ".:") + ": " + reason
}

// Handler is a slog.Handler that writes sentences. Build one with New.
type Handler struct {
	out   io.Writer
	level slog.Leveler
	// now replaces each record's own time when set (tests).
	now   func() time.Time
	mu    *sync.Mutex
	attrs []slog.Attr
	group string
}

// New is a handler that writes to out lines at level or above.
func New(out io.Writer, level slog.Leveler) *Handler {
	return &Handler{out: out, level: level, mu: &sync.Mutex{}}
}

// Enabled reports whether a line at level is written.
func (h *Handler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level.Level()
}

// Handle writes one record.
func (h *Handler) Handle(_ context.Context, record slog.Record) error {
	when := record.Time
	if h.now != nil {
		when = h.now()
	}
	if when.IsZero() {
		when = time.Now()
	}
	var line strings.Builder
	line.WriteString(when.Format(timeLayout))
	line.WriteString("  ")
	switch {
	case record.Level >= slog.LevelError:
		line.WriteString(errorPrefix)
	case record.Level >= slog.LevelWarn:
		line.WriteString(warnPrefix)
	}

	var details []string
	var stack, reason string
	add := func(attr slog.Attr) {
		attr.Value = attr.Value.Resolve()
		if attr.Equal(slog.Attr{}) {
			return
		}
		switch attr.Key {
		case StackKey:
			stack = attr.Value.String()
			return
		case ErrorKey:
			reason = strings.TrimSpace(attr.Value.String())
			return
		}
		details = append(details, h.prefixed(attr.Key)+" "+Value(attr.Key, attr.Value))
	}
	for _, attr := range h.attrs {
		add(attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		add(attr)
		return true
	})
	line.WriteString(sentence(record.Message, reason))
	if len(details) > 0 {
		line.WriteString(" (" + strings.Join(details, ", ") + ")")
	}
	line.WriteString("\n")
	if stack = strings.TrimSpace(stack); stack != "" {
		for _, row := range strings.Split(stack, "\n") {
			line.WriteString(stackIndent + strings.TrimRight(row, "\r") + "\n")
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(h.out, line.String())
	return err
}

// WithAttrs returns a handler whose lines carry attrs as well.
func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := *h
	next.attrs = append(append([]slog.Attr(nil), h.attrs...), attrs...)
	return &next
}

// WithGroup returns a handler whose later attributes are named under group.
func (h *Handler) WithGroup(name string) slog.Handler {
	next := *h
	if name != "" {
		next.group = h.group + name + " "
	}
	return &next
}

func (h *Handler) prefixed(key string) string {
	return h.group + words(key)
}

// words turns an attribute key into plain words: "request_id" is "request id".
func words(key string) string {
	for _, unit := range []string{"_ms", "_bytes"} {
		key = strings.TrimSuffix(key, unit)
	}
	return strings.NewReplacer("_", " ", "-", " ").Replace(key)
}

// Value renders one attribute value for a person. A duration reads as 640ms or 8.9s, a key that
// ends in "ms" with a number is a duration in milliseconds, a key that ends in "bytes" is a size.
func Value(key string, value slog.Value) string {
	switch value.Kind() {
	case slog.KindDuration:
		return Seconds(value.Duration())
	case slog.KindInt64:
		switch {
		case key == "ms" || strings.HasSuffix(key, "_ms"):
			return Seconds(time.Duration(value.Int64()) * time.Millisecond)
		case key == "bytes" || strings.HasSuffix(key, "_bytes"):
			return Bytes(value.Int64())
		}
	}
	text := value.String()
	if strings.ContainsAny(text, " ,()") {
		return fmt.Sprintf("%q", text)
	}
	return text
}

// Seconds is a duration a person reads at a glance: 640ms, 8.9s, 1m 12s.
func Seconds(d time.Duration) string {
	switch {
	case d < 0:
		return "0ms"
	case d < time.Second:
		return fmt.Sprintf("%dms", d.Milliseconds())
	case d < 10*time.Second:
		return fmt.Sprintf("%.1fs", d.Seconds())
	case d < time.Minute:
		return fmt.Sprintf("%.0fs", d.Seconds())
	}
	whole := d.Round(time.Second)
	minutes, seconds := int(whole/time.Minute), int(whole%time.Minute/time.Second)
	if seconds == 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%dm %ds", minutes, seconds)
}

// Bytes is a size a person reads at a glance: 900 B, 31 KB, 1.2 MB.
func Bytes(n int64) string {
	const unit = 1024
	switch {
	case n < unit:
		return fmt.Sprintf("%d B", n)
	case n < unit*unit:
		return fmt.Sprintf("%.0f KB", float64(n)/unit)
	case n < unit*unit*unit:
		return fmt.Sprintf("%.1f MB", float64(n)/(unit*unit))
	}
	return fmt.Sprintf("%.1f GB", float64(n)/(unit*unit*unit))
}

// Count is "1 file" or "3 files": n with the noun in the right number.
func Count(n int, singular string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", singular)
	}
	return fmt.Sprintf("%d %ss", n, singular)
}

// Short is the start of a long identifier (a session, a request, an account): enough to tell two
// apart in a log line, not the whole 24 or 32 characters.
func Short(id string) string {
	const shortLen = 6
	if len(id) <= shortLen {
		return id
	}
	return id[:shortLen]
}
