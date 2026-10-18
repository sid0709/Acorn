package agent

import "testing"

func TestUploadEndsTheRunBeforeScrollOrOtherActions(t *testing.T) {
	runs := splitPlan([]Action{
		{Kind: KindUpload, Check: "résumé attached"},
		{Kind: KindScroll, DY: 400},
		{Kind: KindClick, Check: "email field focused"},
	}, 6)
	if len(runs) != 3 || len(runs[0].actions) != 1 || runs[0].actions[0].Kind != KindUpload {
		t.Fatalf("first run = %+v", runs[0])
	}
	if runs[0].expect != "résumé attached" || len(runs[1].actions) != 1 || runs[1].actions[0].Kind != KindScroll {
		t.Fatalf("runs = %+v", runs)
	}
}

func TestScrollDoesNotShareRunWithEarlierActions(t *testing.T) {
	runs := splitPlan([]Action{
		{Kind: KindType, Text: "Ada", Check: "name shows Ada"},
		{Kind: KindScroll, DY: 300},
		{Kind: KindClick},
	}, 6)
	if len(runs) != 3 || len(runs[0].actions) != 1 || len(runs[1].actions) != 1 || runs[1].actions[0].Kind != KindScroll {
		t.Fatalf("runs = %+v", runs)
	}
}

func TestBatchExcludesScrollAndRunsItAfterFillCheck(t *testing.T) {
	runs := splitPlanForSession([]Action{
		{Kind: KindType, Text: "a", Check: "a shows"},
		{Kind: KindType, Text: "b", Check: "b shows"},
		{Kind: KindScroll, DY: 400},
		{Kind: KindClick, Check: "next field open"},
	}, 6, true)
	if len(runs) < 2 || len(runs[0].actions) != 2 || runs[0].actions[0].Kind != KindType {
		t.Fatalf("first run should batch only fills: %+v", runs[0])
	}
	if len(runs[1].actions) != 1 || runs[1].actions[0].Kind != KindScroll {
		t.Fatalf("scroll must follow the batch: %+v", runs[1])
	}
}

func TestBatchPrefixStopsAtUpload(t *testing.T) {
	runs := splitPlanForSession([]Action{
		{Kind: KindType, Text: "a", Check: "a shows"},
		{Kind: KindType, Text: "b", Check: "b shows"},
		{Kind: KindUpload, Check: "file attached"},
	}, 6, true)
	if len(runs) != 2 || len(runs[0].actions) != 2 || runs[1].actions[0].Kind != KindUpload {
		t.Fatalf("runs = %+v", runs)
	}
}
