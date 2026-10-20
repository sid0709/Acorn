package agent

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// fieldMarks are two controls on the survey's first screen: a text box with a label above it, and a
// dropdown whose box is a long strip with a tiny input in its left end.
func fieldMarks() []ControlMark {
	return []ControlMark{
		{ID: "input:text:first", Kind: "input", Rect: Rect{X: 400, Y: 300, W: 300, H: 40}, Box: &Rect{X: 380, Y: 270, W: 340, H: 90}},
		{ID: "input:combobox:country", Kind: "select", Rect: Rect{X: 425, Y: 500, W: 2, H: 20}, Box: &Rect{X: 400, Y: 470, W: 400, H: 70}},
	}
}

func TestAPointIsOnTheControlWhoseBoxHoldsItElseOnTheOneWhoseFieldDoes(t *testing.T) {
	cases := []struct {
		name string
		x, y float64
		want string
	}{
		{"inside the text box", 500, 320, "input:text:first"},
		{"on the label above it, in its field", 500, 280, "input:text:first"},
		{"on the body of the dropdown, away from its tiny input", 700, 510, "input:combobox:country"},
		{"between the two fields", 500, 420, ""},
		{"far away", 100, 1000, ""},
	}
	for _, c := range cases {
		mark, ok := markAt(fieldMarks(), c.x, c.y)
		if c.want == "" && ok {
			t.Errorf("%s: bound to %s, want no control", c.name, mark.ID)
		}
		if c.want != "" && (!ok || mark.ID != c.want) {
			t.Errorf("%s: bound to %q (found %v), want %s", c.name, mark.ID, ok, c.want)
		}
	}
}

func TestAPointTwoControlsHoldAlikeIsOnNeitherAndTheSmallerBoxWinsOtherwise(t *testing.T) {
	same := []ControlMark{
		{ID: "a", Rect: Rect{X: 0, Y: 0, W: 100, H: 40}},
		{ID: "b", Rect: Rect{X: 0, Y: 0, W: 100, H: 40}},
	}
	if mark, ok := markAt(same, 50, 20); ok {
		t.Fatalf("a point on two identical boxes was bound to %s", mark.ID)
	}
	nested := []ControlMark{
		{ID: "outer", Rect: Rect{X: 0, Y: 0, W: 400, H: 100}},
		{ID: "inner", Rect: Rect{X: 10, Y: 10, W: 100, H: 30}},
	}
	if mark, ok := markAt(nested, 50, 20); !ok || mark.ID != "inner" {
		t.Fatalf("the point is on %q (found %v), want the smaller box", mark.ID, ok)
	}
}

func TestMarksThatCannotBeUsedAreLeftOutAndTheirNumberIsBounded(t *testing.T) {
	good := ControlMark{ID: "ok", Rect: Rect{X: 1, Y: 1, W: 10, H: 10}}
	marks := []ControlMark{
		good,
		{ID: "", Rect: Rect{X: 1, Y: 1, W: 10, H: 10}},
		{ID: "flat", Rect: Rect{X: 1, Y: 1, W: 10, H: 0}},
		{ID: "nan", Rect: Rect{X: math.NaN(), Y: 1, W: 10, H: 10}},
		{ID: "badbox", Rect: Rect{X: 1, Y: 1, W: 10, H: 10}, Box: &Rect{X: 0, Y: 0, W: math.Inf(1), H: 5}},
	}
	got := acceptMarks(marks)
	if len(got) != 2 || got[0].ID != "ok" || got[1].ID != "badbox" || got[1].Box != nil {
		t.Fatalf("accepted %+v, want the usable marks, the broken box dropped", got)
	}
	many := make([]ControlMark, maxMarks+50)
	for i := range many {
		many[i] = good
	}
	if n := len(acceptMarks(many)); n != maxMarks {
		t.Fatalf("%d marks accepted, want at most %d", n, maxMarks)
	}
}

// markedSurvey is the survey with the two fields on its first screen and a text box on its second.
func markedSurvey(t *testing.T) Observation {
	t.Helper()
	obs := surveyObservation(t)
	obs.Marks = append(fieldMarks(), ControlMark{
		ID: "input:text:last", Kind: "input", Rect: Rect{X: 400, Y: 810, W: 300, H: 40}, Box: &Rect{X: 380, Y: 780, W: 340, H: 90},
	})
	return obs
}

func TestEveryPointOfAPlanIsBoundToItsControlAndTheStepSendsIt(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("filling", nil,
		labelled(1, 500, 320, "First Name"), typeAction("Ada", nil),
		labelled(2, 500, 130, "Last Name"), typeAction("Lovelace", nil),
		labelled(1, 100, 700, "Somewhere else"),
	)}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, true), markedSurvey(t))
	if len(step.Actions) != 5 {
		t.Fatalf("%d actions: %s", len(step.Actions), kinds(step.Actions))
	}
	first, last, nowhere := step.Actions[0], step.Actions[2], step.Actions[4]
	if first.Mark == nil || first.Mark.ID != "input:text:first" || first.Mark.Y != 300 {
		t.Fatalf("the first click has %+v, want the first text box as it sits on the page", first.Mark)
	}
	// The second click is measured on the screen scrolled to 680: its place on the page is 680 + 130.
	if last.Mark == nil || last.Mark.ID != "input:text:last" {
		t.Fatalf("the second click has %+v, want the last text box (the screen's own scroll counts)", last.Mark)
	}
	if nowhere.Mark != nil {
		t.Fatalf("a point on no control was bound to %+v", nowhere.Mark)
	}
	if step.Actions[1].Mark != nil {
		t.Fatal("typed text carries a control")
	}
	raw, _ := json.Marshal(first)
	if !strings.Contains(string(raw), `"mark":{"id":"input:text:first","x":400,"y":300,"w":300,"h":40}`) {
		t.Fatalf("the control is not on the wire as the extension reads it: %s", raw)
	}
}

func TestAClickTheAgentMakesForADropdownCarriesTheControlOfTheChoose(t *testing.T) {
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 510, "Country", "United States"))}, &fakeScreen{}, DefaultConfig())
	first := stepOK(t, a, id, markedSurvey(t))
	open := firstClick(t, first.Actions)
	if open.Mark == nil || open.Mark.ID != "input:combobox:country" {
		t.Fatalf("the click that opens the dropdown has %+v", open.Mark)
	}
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	back := firstClick(t, second.Actions)
	if back.Mark == nil || back.Mark.ID != "input:combobox:country" {
		t.Fatalf("the click that picks in it has %+v", back.Mark)
	}
}

func TestARunWithoutFastFillBindsNothingAndASurveyWithoutMarksNeither(t *testing.T) {
	reply := plan("filling", nil, labelled(1, 500, 320, "First Name"))
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, false), markedSurvey(t))
	if len(step.Actions) == 0 || step.Actions[0].Mark != nil {
		t.Fatalf("a run without fast fill was given controls: %+v", step.Actions)
	}
	plain := &scriptedModel{replies: []string{reply}}
	b := newAgentWithScreen(t, plain, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step = stepOK(t, b, startFast(t, b, true), surveyObservation(t))
	if len(step.Actions) == 0 || step.Actions[0].Mark != nil {
		t.Fatalf("a survey without marks was given controls: %+v", step.Actions)
	}
}

func TestMarksAndTheLayoutComeInFromTheWireAsTheExtensionWritesThem(t *testing.T) {
	raw := `{"screenshot":"x","url":"u","title":"t","viewport":{"width":1,"height":1,"scrollX":0,"scrollY":0,"pageWidth":1,"pageHeight":1},` +
		`"marks":[{"id":"a","kind":"input","x":1,"y":2,"w":3,"h":4,"box":{"x":0,"y":1,"w":5,"h":6}},{"id":"b","kind":"button","x":1,"y":2,"w":3,"h":4}],` +
		`"layout":[{"from":10,"at":20,"dy":30}]}`
	var obs Observation
	if err := json.Unmarshal([]byte(raw), &obs); err != nil {
		t.Fatal(err)
	}
	if len(obs.Marks) != 2 || obs.Marks[0].Box == nil || obs.Marks[0].Box.H != 6 || obs.Marks[0].W != 3 || obs.Marks[1].Box != nil {
		t.Fatalf("marks = %+v", obs.Marks)
	}
	if len(obs.Layout) != 1 || obs.Layout[0] != (LayoutMove{From: 10, At: 20, Dy: 30}) {
		t.Fatalf("layout = %+v", obs.Layout)
	}
}
