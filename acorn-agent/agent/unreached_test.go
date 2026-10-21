package agent

import (
	"strings"
	"testing"
)

func unreachedResults(clickOK bool) []ActionResult {
	return []ActionResult{{ID: "s2a10", OK: clickOK}, {ID: "s2a11", OK: false, Error: "nothing has focus, so this would scroll the page instead of reaching a control: click the control first"}}
}

func TestAClickThatReachedNoControlIsToldWhereTheControlLiesFromItsPoint(t *testing.T) {
	obs := observation("")
	obs.Marks = phoneMarks()
	click := phoneClick("Phone")
	click.ID = "s2a10"
	byID := map[string]Action{"s2a10": click, "s2a11": {ID: "s2a11", Kind: KindType, Text: "4243207354"}}
	notes := unreachedNotes(unreachedResults(true), byID, nil, obs)
	if len(notes) != 1 {
		t.Fatalf("want one note, got %q", notes)
	}
	for _, want := range []string{
		`Acorn clicked for "Phone" at (575, 784) on screen 1, but no control took focus there, so typing "4243207354" was not done.`,
		`The page's text box "Phone" has its top edge 9 px below the point: aim inside its edges`,
	} {
		if !strings.Contains(notes[0], want) {
			t.Fatalf("missing %q in:\n%s", want, notes[0])
		}
	}
}

func TestTheNoteNamesTheControlsNearThePointWhenNoneCarriesTheLabel(t *testing.T) {
	obs := observation("")
	obs.Marks = phoneMarks()
	click := phoneClick("Telephone number")
	click.ID = "s2a10"
	secret := Action{ID: "s2a11", Kind: KindType, Text: "4243207354", Secret: true}
	byID := map[string]Action{"s2a10": click, "s2a11": secret}
	notes := unreachedNotes(unreachedResults(true), byID, nil, obs)
	if len(notes) != 1 {
		t.Fatalf("want one note, got %q", notes)
	}
	for _, want := range []string{
		`so the typing was not done.`,
		`The page's controls near that point: text box "Phone" has its top edge 9 px below the point; button "+1" has its top edge 9 px below the point and its right edge 124 px left of the point.`,
	} {
		if !strings.Contains(notes[0], want) {
			t.Fatalf("missing %q in:\n%s", want, notes[0])
		}
	}
	if strings.Contains(notes[0], "4243207354") {
		t.Fatal("a secret was written into the note")
	}
}

func TestAClickOnItsControlThatGaveNoFocusIsToldSoAndOtherFailuresGetNoNote(t *testing.T) {
	obs := observation("")
	obs.Marks = phoneMarks()
	click := phoneClick("Phone")
	click.ID = "s2a10"
	keys := Action{ID: "s2a11", Kind: KindKey, Keys: "Home Enter"}
	byID := map[string]Action{"s2a10": click, "s2a11": keys}
	bound := map[string]MarkRef{"s2a10": {ID: "input:tel:phone:Phone", Label: "Phone", Kind: MarkKindInput}}
	notes := unreachedNotes(unreachedResults(true), byID, bound, obs)
	if len(notes) != 1 || !strings.Contains(notes[0], `pressing Home Enter was not done. The point is on the text box the page reports as "Phone", so that control may be disabled, or covered`) {
		t.Fatalf("a bound click that gave no focus was not told so: %q", notes)
	}
	if notes := unreachedNotes(unreachedResults(false), byID, nil, obs); len(notes) != 0 {
		t.Fatalf("typing after a click that failed itself got a note: %q", notes)
	}
	if notes := unreachedNotes(unreachedResults(true), byID, nil, observation("")); len(notes) != 0 {
		t.Fatalf("a look without the page's controls gave a note: %q", notes)
	}
	if notes := unreachedNotes([]ActionResult{{ID: "s2a11", OK: false, Error: "no text"}}, byID, nil, obs); len(notes) != 0 {
		t.Fatalf("typing with no click before it got a note: %q", notes)
	}
}
