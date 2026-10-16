package agent

import "testing"

func TestEveryPointOfAPlanIsPinnedToTheScrollOfItsScreenshotUpToTheFirstScroll(t *testing.T) {
	vp := Viewport{Width: 1280, Height: 800, ScrollY: 854, PageHeight: 2400}
	x, y := 10.0, 10.0
	plan := []Action{
		{Kind: KindClick, X: &x, Y: &y}, {Kind: KindType, Text: "a"}, {Kind: KindChoose, X: &x, Y: &y, Text: "No"},
		{Kind: KindScroll, DY: 400}, {Kind: KindClick, X: &x, Y: &y},
	}
	pinFrame(plan, vp, 0)
	for _, i := range []int{0, 2} {
		if plan[i].ScrollTo == nil || *plan[i].ScrollTo != 854 {
			t.Fatalf("action %d is not pinned: %v", i, plan[i].ScrollTo)
		}
		if plan[i].PageHeight != 0 {
			t.Fatalf("action %d carries a page height: the page's height changes as a form is filled, so it is not checked", i)
		}
	}
	if plan[1].ScrollTo != nil {
		t.Fatal("typing has no point")
	}
	if plan[4].ScrollTo != nil {
		t.Fatal("what follows the plan's own scroll was aimed at a page the plan moved")
	}
}

func TestAPointThatAlreadyHasAScrollKeepsItAndASurveyPinsNothing(t *testing.T) {
	x, y, own := 10.0, 10.0, 300.0
	kept := []Action{{Kind: KindClick, X: &x, Y: &y, ScrollTo: &own}}
	pinFrame(kept, Viewport{ScrollY: 854}, 0)
	if *kept[0].ScrollTo != 300 {
		t.Fatal("a survey screen's own position was replaced")
	}
	survey := []Action{{Kind: KindClick, X: &x, Y: &y}}
	pinFrame(survey, Viewport{ScrollY: 854}, 3)
	if survey[0].ScrollTo != nil {
		t.Fatal("a survey sets its own positions")
	}
}
