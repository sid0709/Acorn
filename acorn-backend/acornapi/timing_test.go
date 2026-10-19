package acornapi

import (
	"net/http/httptest"
	"regexp"
	"testing"
)

func TestTimingWritesEachStepAndTheTotal(t *testing.T) {
	rec := httptest.NewRecorder()
	timer := startTiming()
	timer.step(timingClaim)
	timer.step(timingMessages)
	timer.apply(rec)
	got := rec.Header().Get("Server-Timing")
	want := regexp.MustCompile(`^claim;dur=\d+\.\d, messages;dur=\d+\.\d, total;dur=\d+\.\d$`)
	if !want.MatchString(got) {
		t.Fatalf("Server-Timing = %q", got)
	}
}

func TestTimingApplyIsRepeatable(t *testing.T) {
	timer := startTiming()
	timer.step(timingList)
	first, second := httptest.NewRecorder(), httptest.NewRecorder()
	timer.apply(first)
	timer.apply(second)
	for _, rec := range []*httptest.ResponseRecorder{first, second} {
		if got := rec.Header().Get("Server-Timing"); !regexp.MustCompile(`^list;dur=\S+, total;dur=\S+$`).MatchString(got) {
			t.Fatalf("Server-Timing = %q", got)
		}
	}
}
