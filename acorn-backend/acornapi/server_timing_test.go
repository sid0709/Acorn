package acornapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStepTimerWritesEachStepAsServerTiming(t *testing.T) {
	timer := newStepTimer()
	timer.step("auth", "")
	timer.step("library", "variants=2")
	recorder := httptest.NewRecorder()
	timer.write(recorder)
	got := recorder.Header().Get(serverTimingHeader)
	if !strings.HasPrefix(got, "auth;dur=") || !strings.Contains(got, `library;dur=`) || !strings.Contains(got, `desc="variants=2"`) {
		t.Fatalf("header = %q", got)
	}
}

func TestStepTimerWithNoStepsSetsNoHeader(t *testing.T) {
	recorder := httptest.NewRecorder()
	newStepTimer().write(recorder)
	if _, set := recorder.Header()[serverTimingHeader]; set {
		t.Fatal("an empty timer must not set the header")
	}
}
