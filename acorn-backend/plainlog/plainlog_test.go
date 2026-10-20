package plainlog

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func logger(buf *bytes.Buffer, level slog.Level) *slog.Logger {
	handler := New(buf, level)
	handler.now = func() time.Time { return time.Date(2026, 10, 20, 10, 1, 14, 0, time.Local) }
	return slog.New(handler)
}

func TestALineIsTheTimeThenTheSentence(t *testing.T) {
	var buf bytes.Buffer
	logger(&buf, slog.LevelInfo).Info("Run 42cd is looking at the page.")
	if got, want := buf.String(), "10:01:14  Run 42cd is looking at the page.\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestWarningsAndProblemsSayWhatTheyAre(t *testing.T) {
	var buf bytes.Buffer
	log := logger(&buf, slog.LevelInfo)
	log.Warn("The database was slow.")
	log.Error("The server stopped.")
	want := "10:01:14  Heads up: The database was slow.\n10:01:14  Problem: The server stopped.\n"
	if buf.String() != want {
		t.Fatalf("got %q, want %q", buf.String(), want)
	}
}

func TestDebugLinesAreHiddenUnlessAsked(t *testing.T) {
	var buf bytes.Buffer
	logger(&buf, slog.LevelInfo).Debug("noise")
	if buf.Len() != 0 {
		t.Fatalf("a debug line was written: %q", buf.String())
	}
	logger(&buf, slog.LevelDebug).Debug("detail")
	if !strings.Contains(buf.String(), "Detail") {
		t.Fatalf("a debug line was hidden when asked for: %q", buf.String())
	}
}

func TestDetailsGoInBracketsInPlainWords(t *testing.T) {
	var buf bytes.Buffer
	logger(&buf, slog.LevelInfo).Info("Answered.", "request_id", "ab12", "took_ms", int64(8883), "size_bytes", int64(2048), "waited", 640*time.Millisecond, "note", "two words")
	want := "10:01:14  Answered. (request id ab12, took 8.9s, size 2 KB, waited 640ms, note \"two words\")\n"
	if buf.String() != want {
		t.Fatalf("got %q, want %q", buf.String(), want)
	}
}

func TestAStackIsPrintedUnderTheSentence(t *testing.T) {
	var buf bytes.Buffer
	logger(&buf, slog.LevelInfo).Error("A request failed.", StackKey, "main.go:10\nmain.go:20")
	want := "10:01:14  Problem: A request failed.\n      main.go:10\n      main.go:20\n"
	if buf.String() != want {
		t.Fatalf("got %q, want %q", buf.String(), want)
	}
}

func TestWithAttrsAndGroupsKeepTheirNames(t *testing.T) {
	var buf bytes.Buffer
	log := logger(&buf, slog.LevelInfo).With("run", "42cd").WithGroup("page")
	log.Info("Loaded.", "url", "x")
	if got := buf.String(); !strings.Contains(got, "run 42cd") || !strings.Contains(got, "page url x") {
		t.Fatalf("got %q", got)
	}
}

func TestHelpersReadAtAGlance(t *testing.T) {
	for in, want := range map[time.Duration]string{
		640 * time.Millisecond: "640ms", 8900 * time.Millisecond: "8.9s", 42 * time.Second: "42s",
		72 * time.Second: "1m 12s", 2 * time.Minute: "2m", -time.Second: "0ms",
	} {
		if got := Seconds(in); got != want {
			t.Errorf("Seconds(%v) = %q, want %q", in, got, want)
		}
	}
	if Bytes(900) != "900 B" || Bytes(31<<10) != "31 KB" || Bytes(158222733) != "150.9 MB" {
		t.Errorf("Bytes: %s %s %s", Bytes(900), Bytes(31<<10), Bytes(158222733))
	}
	if Count(1, "file") != "1 file" || Count(3, "file") != "3 files" || Count(0, "file") != "0 files" {
		t.Error("Count is wrong")
	}
	if Short("eccdbf18f346fa57") != "eccdbf" || Short("ab") != "ab" {
		t.Error("Short is wrong")
	}
}

func TestEnabledFollowsTheLevel(t *testing.T) {
	handler := New(&bytes.Buffer{}, slog.LevelWarn)
	if handler.Enabled(context.Background(), slog.LevelInfo) || !handler.Enabled(context.Background(), slog.LevelWarn) {
		t.Fatal("Enabled ignores the level")
	}
}

func TestAnErrorEndsTheSentenceAndTheFirstLetterIsCapital(t *testing.T) {
	var buf bytes.Buffer
	logger(&buf, slog.LevelInfo).Error("acorn admin users", "error", "connection refused", "user", "ab12")
	want := "10:01:14  Problem: Acorn admin users: connection refused (user ab12)\n"
	if buf.String() != want {
		t.Fatalf("got %q, want %q", buf.String(), want)
	}
}
