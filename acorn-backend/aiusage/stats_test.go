package aiusage

import (
	"testing"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/openai"
)

func TestStatusOfSeparatesCancelsFromFailures(t *testing.T) {
	cases := []struct {
		usage openai.Usage
		want  string
	}{
		{openai.Usage{}, StatusOK},
		{openai.Usage{Error: "boom", ErrorKind: openai.ErrorKindProvider}, StatusError},
		{openai.Usage{Error: "context canceled", ErrorKind: openai.ErrorKindCancelled}, StatusCancelled},
	}
	for _, tc := range cases {
		if got := StatusOf(tc.usage); got != tc.want {
			t.Errorf("StatusOf(%+v) = %q, want %q", tc.usage, got, tc.want)
		}
	}
}

func TestSummaryRatesLeaveCancelsOut(t *testing.T) {
	p95 := 1200.0
	s := groupRow{
		Calls: 10, OK: 8, Errors: 1, Cancelled: 1, Users: 2,
		PromptTokens: 1000, CachedTokens: 250, TotalTokens: 2000, CostNanos: 4000,
		Pcts: []*float64{nil, nil, &p95, nil}, OKCompletionTokens: 500, OKDurationMs: 2000,
		Retried: 1, Truncated: 2,
	}.summary()
	if s.SuccessRate != 8.0/9 || s.ErrorRate != 1.0/9 || s.CancelRate != 0.1 {
		t.Fatalf("rates = %v %v %v", s.SuccessRate, s.ErrorRate, s.CancelRate)
	}
	if s.CacheHitRate != 0.25 || s.P95Ms != 1200 || s.TokensPerSecond != 250 || s.TruncationRate != 0.25 {
		t.Fatalf("summary = %+v", s)
	}
	if s.CostPerCallNanos != 400 || s.CostPerUserNanos != 2000 || s.CostPer1kTokensNanos != 2000 {
		t.Fatalf("unit costs = %+v", s)
	}
}

func TestSLOStatus(t *testing.T) {
	success := sloTargets[0]
	latency := sloTargets[1]
	cases := []struct {
		target sloTarget
		actual float64
		want   string
	}{
		{success, 0.995, SLOMet},
		{success, 0.986, SLOAtRisk},
		{success, 0.95, SLOBreached},
		{latency, 4000, SLOMet},
		{latency, 7000, SLOAtRisk},
		{latency, 9000, SLOBreached},
	}
	for _, tc := range cases {
		if got := sloStatus(tc.target, tc.actual); got != tc.want {
			t.Errorf("%s at %v = %q, want %q", tc.target.key, tc.actual, got, tc.want)
		}
	}
	if got := evaluateSLOs(Summary{}); got[0].Status != SLONoData {
		t.Errorf("empty period = %q, want no data", got[0].Status)
	}
}

func TestFillSeriesHasEveryBucket(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 30, 0, 0, time.UTC)
	current, _ := Filter{Range: Range24h}.windows(now)
	hit := time.Date(2026, 10, 7, 3, 0, 0, 0, time.UTC)
	points := fillSeries(current, []pointRow{{ID: hit, Metrics: groupRow{Calls: 4}}})
	if len(points) != 25 {
		t.Fatalf("points = %d, want 25 hourly buckets", len(points))
	}
	for _, p := range points {
		if p.Start.Equal(hit) && p.Calls != 4 {
			t.Fatalf("bucket %v lost its calls", hit)
		}
	}
}

func TestFilterLeavesSupportOutByDefault(t *testing.T) {
	m := Filter{}.match(Window{})
	if m["supportBy"] != "" {
		t.Fatalf("match = %v", m)
	}
	if _, ok := (Filter{IncludeSupport: true}).match(Window{})["supportBy"]; ok {
		t.Fatal("includeSupport should not filter")
	}
}
