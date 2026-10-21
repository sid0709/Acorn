package agent

import (
	"strings"
	"testing"
)

func TestAPointAlreadyOnAControlOrInNoFieldIsNotMoved(t *testing.T) {
	obs := markedSurvey(t)
	x, onBox, nowhere := 500.0, 320.0, 420.0
	scroll := 0.0
	at := func(y float64) []Action { return []Action{{ID: "a", Kind: KindClick, X: &x, Y: &y, ScrollTo: &scroll}} }
	if _, did := aimAtControls(at(onBox), obs); did.moved != 0 {
		t.Fatal("a point on a control was moved")
	}
	if _, did := aimAtControls(at(nowhere), obs); did.moved != 0 {
		t.Fatal("a point in no field was moved")
	}
	if _, did := aimAtControls(at(280), surveyObservation(t)); did.moved != 0 {
		t.Fatal("a point was moved on a look without marks")
	}
	moved, did := aimAtControls(at(280), obs)
	if did.moved != 1 || *moved[0].Y != 320 || *moved[0].X != 500 {
		t.Fatalf("the point on the label was not moved onto the box: %+v %+v", moved, did)
	}
}

func TestAPointOnTheWordsInsideABoxIsMovedToTheLineUnderThem(t *testing.T) {
	// A bordered field whose question is printed inside it: the box is 100 px tall, the words fill its top
	// 70 px, and the page says the entry is the 30 px under them.
	obs := surveyObservation(t)
	obs.Marks = []ControlMark{{
		ID: "input:text:sponsorship", Kind: MarkKindInput, Label: "Will you require sponsorship?",
		Rect:  Rect{X: 240, Y: 700, W: 540, H: 100},
		Entry: &Rect{X: 240, Y: 770, W: 540, H: 30},
	}}
	x, y, scroll := 490.0, 740.0, 0.0
	moved, did := aimAtControls([]Action{{ID: "a", Kind: KindClick, X: &x, Y: &y, ScrollTo: &scroll}}, obs)
	if did.moved != 1 || *moved[0].X != 490 || *moved[0].Y != 785 {
		t.Fatalf("the point is at (%v, %v), want (490, 785): on the entry line, at its own x", *moved[0].X, *moved[0].Y)
	}
	on := 780.0
	if _, did := aimAtControls([]Action{{ID: "a", Kind: KindClick, X: &x, Y: &on, ScrollTo: &scroll}}, obs); did.moved != 0 {
		t.Fatal("a point on the entry line was moved")
	}
}

func TestAPointOnATallDropdownsQuestionIsMovedOntoItsOwnInput(t *testing.T) {
	// The dropdown's field is a long strip and its input a tiny box in its left end: a point on the body of
	// the strip, away from the input, is moved onto the input, x and all.
	obs := markedSurvey(t)
	x, y, scroll := 700.0, 480.0, 0.0
	moved, did := aimAtControls([]Action{{ID: "a", Kind: KindChoose, Text: "Canada", X: &x, Y: &y, ScrollTo: &scroll}}, obs)
	if did.moved != 1 || *moved[0].X != 426 || *moved[0].Y != 510 {
		t.Fatalf("the point is at (%v, %v), want the input's middle (426, 510)", *moved[0].X, *moved[0].Y)
	}
	if moved[0].Kind != KindChoose || moved[0].Text != "Canada" {
		t.Fatalf("a choose on a dropdown stayed a choose: %+v", moved[0])
	}
}

func TestAPointIsMeasuredOnItsOwnScreenAndNotMovedOffIt(t *testing.T) {
	obs := markedSurvey(t)
	// The last text box sits at page y 810: on the screen scrolled to 680 its box is at 130 and its label at 110.
	x, y, screen := 500.0, 110.0, 680.0
	moved, did := aimAtControls([]Action{{ID: "a", Kind: KindClick, X: &x, Y: &y, ScrollTo: &screen}}, obs)
	if did.moved != 1 || *moved[0].Y != 150 {
		t.Fatalf("the point is at y %v, want 150: the box's middle on that screen", *moved[0].Y)
	}
	// Measured on the first screen the box's middle is at 830, past the 800 px screen: the point stays.
	top := 0.0
	far := 790.0
	if _, did := aimAtControls([]Action{{ID: "a", Kind: KindClick, X: &x, Y: &far, ScrollTo: &top}}, obs); did.moved != 0 {
		t.Fatal("a point was moved off the screen it was measured on")
	}
}

func TestAChooseOnATextBoxIsClickedAndTypedInstead(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("filling", nil, chooseWithLabel(1, 500, 280, "Sponsorship", "No"))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	step := stepOK(t, a, id, markedSurvey(t))
	if len(step.Actions) != 2 || step.Actions[0].Kind != KindClick || step.Actions[1].Kind != KindType || step.Actions[1].Text != "No" {
		t.Fatalf("actions = %s: a choose on a text box must be a click and the typed answer", kinds(step.Actions))
	}
	if *step.Actions[0].Y != 320 || step.Actions[0].Mark == nil || step.Actions[0].Mark.ID != "input:text:first" {
		t.Fatalf("the click is not on the text box: %+v", step.Actions[0])
	}
	if step.Actions[1].ID != step.Actions[0].ID+"t" {
		t.Fatalf("the typed answer is not the choose's own: %s after %s", step.Actions[1].ID, step.Actions[0].ID)
	}
	s, _ := a.sessions.get(id)
	if len(s.notes) == 0 || !strings.Contains(s.notes[0], "text box") {
		t.Fatalf("the model is not told the box is a text box: %v", s.notes)
	}
	if s.expect[1] == nil || s.expect[1][0].Label != "Sponsorship" || s.expect[1][0].Value != "No" {
		t.Fatalf("the typed answer is not reviewed with the field's label: %+v", s.expect)
	}
}

func TestLabelsAgreeWhenTheyAreTheSameWordsOrOneBeginsWithTheOther(t *testing.T) {
	for _, tc := range []struct {
		planned, page string
		want          bool
	}{
		{"First Name", "First Name *", true},
		{"first name", "FIRST NAME:", true},
		{"Email", "Email address", true},
		{"Do you have a disability or chronic condition", "Do you have a disability or chronic condition (physical, visual…", true},
		{"Do you have a disability or chronic condition (physical, visual, auditory, cognitive, mental, emotional…", "Do you have a disability or chronic condition", true},
		{"Apply", "Apply", true},
		{"Phone", "Phone number", true},
		{"At this time, Chainguard is unable to provide employment sponsorship. Will you n…", "At this time, Chainguard is unable to provide employment spo", true},
		{"Pho", "Phone", false},
		{"Email", "Country", false},
		{"Last Name", "First Name", false},
		{"", "First Name", false},
		{"No", "No", false},
		{"Gender", "How would you describe your gender identity?", false},
	} {
		if got := labelsAgree(tc.planned, tc.page); got != tc.want {
			t.Errorf("labelsAgree(%q, %q) = %v, want %v", tc.planned, tc.page, got, tc.want)
		}
	}
}
