package applicant

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestTimingReportsTheAgentsHopAndPassesTheBackendsOn(t *testing.T) {
	ctx, timing := WithTiming(context.Background())
	if timing.ServerTiming() != "" {
		t.Fatal("a request that called no backend has nothing to report")
	}
	record(ctx, 120*time.Millisecond, 30*time.Millisecond, 4096, `auth;dur=1.0, library;dur=900.5;desc="variants=2"`)
	got := timing.ServerTiming()
	for _, want := range []string{
		`backend-wait;dur=120.0;desc="calls=1"`,
		`backend-read;dur=30.0;desc="bytes=4096"`,
		`backend-in-auth;dur=1.0`,
		`backend-in-library;dur=900.5;desc="variants=2"`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("%q is missing %q", got, want)
		}
	}
}

func TestRecordWithoutATimingIsIgnored(t *testing.T) {
	record(context.Background(), time.Second, time.Second, 1, "")
}
