package agent

import (
	"strings"
	"testing"
)

func TestBatchFillUsesOneRunAndCombinedExpect(t *testing.T) {
	actions := []Action{
		{Kind: KindType, Text: "Ada", Check: "first name shows Ada"},
		{Kind: KindType, Text: "ada@example.com", Check: "email shows ada@example.com"},
	}
	runs := splitPlanForSession(actions, 6, true, false)
	if len(runs) != 1 || len(runs[0].actions) != 2 {
		t.Fatalf("runs = %+v", runs)
	}
	if !strings.Contains(runs[0].expect, "all of the following") {
		t.Fatalf("expect = %q", runs[0].expect)
	}
	if !strings.Contains(runs[0].expect, "first name shows Ada") || !strings.Contains(runs[0].expect, "email shows ada@example.com") {
		t.Fatalf("expect = %q", runs[0].expect)
	}
}

func TestOneFieldDoesNotBatch(t *testing.T) {
	actions := []Action{
		{Kind: KindType, Text: "Ada", Check: "name shows Ada"},
		{Kind: KindClick, Check: ""},
	}
	runs := splitPlanForSession(actions, 6, true, false)
	if len(runs) != 2 {
		t.Fatalf("runs = %+v", runs)
	}
}

func TestGranularModeSplitsToOneActionPerRun(t *testing.T) {
	actions := []Action{
		{Kind: KindType, Text: "a", Check: "a shows"},
		{Kind: KindType, Text: "b", Check: "b shows"},
	}
	runs := splitPlanForSession(actions, 6, true, true)
	if len(runs) != 2 || len(runs[0].actions) != 1 || len(runs[1].actions) != 1 {
		t.Fatalf("runs = %+v", runs)
	}
}
