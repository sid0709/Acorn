package agent

import (
	"context"
	"strings"
	"testing"
)

// dropdowns is a plan that sets one field and then two dropdowns (the second one lower on the page).
func dropdowns(first, second string) string {
	return plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		chooseWithLabel(1, 500, 300, "Sponsorship", first),
		chooseWithLabel(1, 500, 500, "Gender", second),
	)
}

func chooseWithLabel(screen int, x, y float64, label, answer string) map[string]any {
	return map[string]any{"kind": "choose", "screen": screen, "x": x, "y": y, "label": label, "text": answer}
}

// snapsOf are the snap actions of a batch, in order.
func snapsOf(actions []Action) []Action {
	var out []Action
	for _, action := range actions {
		if action.Kind == KindSnap {
			out = append(out, action)
		}
	}
	return out
}

// carriedOut is the results of a whole batch, every action done.
func carriedOut(actions []Action) []ActionResult {
	out := make([]ActionResult, len(actions))
	for i, action := range actions {
		out[i] = ActionResult{ID: action.ID, OK: true}
	}
	return out
}

// sends is the extension sending the pictures of a batch's snap actions, as it does while carrying it out.
func sends(t *testing.T, a *Agent, id string, actions []Action, focus map[int]*Focus) {
	t.Helper()
	for i, snap := range snapsOf(actions) {
		upload := ShotUpload{Kind: ShotSnap, ID: snap.ID, Screenshot: shot(t, uint8(50+10*i)), Focus: focus[i]}
		if err := a.ReceiveShot(context.Background(), id, upload); err != nil {
			t.Fatal(err)
		}
	}
}

func keysOf(actions []Action) []string {
	var out []string
	for _, action := range actions {
		if action.Kind == KindKey {
			out = append(out, action.Keys)
		}
	}
	return out
}

func newProbeAgent(t *testing.T, replies []string, screen *fakeScreen, cfg Config) (*Agent, string) {
	t.Helper()
	a := newAgentWithScreen(t, &scriptedModel{replies: replies}, &fixedDecider{}, screen, cfg)
	return a, startFast(t, a, true)
}

func TestDropdownsOfAFastFillRunAreProbedTogetherAndThenPickedWithoutLookingBetween(t *testing.T) {
	screen := &fakeScreen{optionByAnswer: map[string]optionVerdict{"No": {1, 0.95}, "Male": {3, 0.95}}}
	a, id := newProbeAgent(t, []string{dropdowns("No", "Male")}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))

	// One batch: the field is filled, then each dropdown is opened, waited for, photographed and closed.
	snaps := snapsOf(first.Actions)
	if len(snaps) != 2 {
		t.Fatalf("%d pictures in the first batch (%s), want one for each dropdown", len(snaps), kinds(first.Actions))
	}
	if first.Actions[0].Kind != KindClick || first.Actions[1].Kind != KindType {
		t.Fatalf("the field was not filled first: %s", kinds(first.Actions))
	}
	if escapes := keysOf(first.Actions); len(escapes) != 2 || escapes[0] != probeEscape {
		t.Fatalf("the lists were not closed: %v", escapes)
	}

	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)

	// The next batch picks in both, bottom one first (as the script does), with the keys of its place.
	picked := keysOf(second.Actions)
	if len(picked) != 2 || picked[0] != optionKeys(3) || picked[1] != optionKeys(1) {
		t.Fatalf("keys = %v, want %q then %q", picked, optionKeys(3), optionKeys(1))
	}
	if !second.Survey {
		t.Fatal("the run's last batch is not followed by a survey")
	}
	for _, action := range second.Actions {
		if action.Kind == KindSnap {
			t.Fatal("a picture was taken to check a pick: nothing checks it")
		}
	}
	s, _ := a.sessions.get(id)
	if s.probe != nil || s.script != nil {
		t.Fatal("the run is over but the session still holds it")
	}
	if screen.requests == nil || len(screen.requests) < 2 {
		t.Fatalf("the two lists were not both read: %d requests", len(screen.requests))
	}
}

func TestAListThatIsTooLongToCountIsNarrowedByTypingTheAnswerAndPhotographedAgain(t *testing.T) {
	// "Canada" is the 8th option of its list, further than an unnarrowed list is counted.
	screen := &fakeScreen{optionByAnswer: map[string]optionVerdict{"Canada": {8, 0.95}}}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Country", "Canada"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)

	// The list is closed, opened again, the answer typed, and a picture taken: the list is left open.
	if len(snapsOf(second.Actions)) != 1 {
		t.Fatalf("no second picture: %s", kinds(second.Actions))
	}
	var typed bool
	for _, action := range second.Actions {
		typed = typed || (action.Kind == KindType && action.Text == "Canada")
	}
	if !typed {
		t.Fatalf("the answer was not typed: %+v", second.Actions)
	}
	if second.Survey {
		t.Fatal("a survey was asked for before the dropdown was set")
	}

	// Narrowed, the answer is the first of the options left.
	screen.optionByAnswer["Canada"] = optionVerdict{1, 0.95}
	sends(t, a, id, second.Actions, nil)
	obs = observation(shot(t, 170))
	obs.Results = carriedOut(second.Actions)
	third := stepOK(t, a, id, obs)
	if got := keysOf(third.Actions); len(got) != 2 || got[0] != probeEscape || got[1] != optionKeys(1) {
		t.Fatalf("keys = %v: the open list is closed, then the answer is picked", got)
	}
	var again bool
	for _, action := range third.Actions {
		again = again || (action.Kind == KindType && action.Text == "Canada")
	}
	if !again || !third.Survey {
		t.Fatalf("the answer was not typed again before picking, or no survey followed: %+v", third.Actions)
	}
}

func TestANativeListIsPickedFromItsOptionsAsText(t *testing.T) {
	screen := &fakeScreen{nativeChoice: "option_1"}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Sponsorship", "No"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sends(t, a, id, first.Actions, map[int]*Focus{0: {Tag: "select", Label: "Sponsorship", Options: []string{"Yes, I will", "No, I will not"}}})
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	var typed string
	for _, action := range second.Actions {
		if action.Kind == KindType {
			typed = action.Text
		}
	}
	if typed != "No, I will not" || keysOf(second.Actions)[0] != "Enter" {
		t.Fatalf("a native list was not picked by its text: %+v", second.Actions)
	}
}

func TestASearchBoxWhoseListIsNotOpenIsTypedInTheProbeBatch(t *testing.T) {
	// The first picture shows no list (a search box, or a list that has not drawn). Position 0 keeps
	// pickOptionFrom from treating a sure option as proof the list is open.
	screen := &fakeScreen{closedLooks: 1}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Country", "United States"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	var typed bool
	for _, action := range second.Actions {
		typed = typed || (action.Kind == KindType && action.Text == "United States")
	}
	if !typed || len(snapsOf(second.Actions)) != 1 {
		t.Fatalf("a search box was not typed and photographed in the batch: %s", kinds(second.Actions))
	}
	s, _ := a.sessions.get(id)
	if s.probe == nil || s.script != nil {
		t.Fatal("the search box was handed to the one-at-a-time script")
	}
}

func TestAClickTheAgentMakesForADropdownKeepsItsAnchor(t *testing.T) {
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Country", "United States"))}, &fakeScreen{}, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	s, _ := a.sessions.get(id)
	open := firstClick(t, first.Actions)
	if _, ok := s.anchors[open.ID]; !ok {
		t.Fatal("the probe's click has no anchor")
	}
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	s, _ = a.sessions.get(id)
	back := firstClick(t, second.Actions)
	if _, ok := s.anchors[back.ID]; !ok {
		t.Fatalf("the click handed back to the script (%s) has no anchor", back.ID)
	}
}

func firstClick(t *testing.T, actions []Action) Action {
	t.Helper()
	for _, action := range actions {
		if action.Kind == KindClick {
			return action
		}
	}
	t.Fatalf("no click in %s", kinds(actions))
	return Action{}
}

func TestADropdownThatCannotBeReadGoesBackToTheScript(t *testing.T) {
	// No picture arrives for it (the upload failed): the script sets it, one dropdown at a time.
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Sponsorship", "No"))}, &fakeScreen{}, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	s, _ := a.sessions.get(id)
	if s.probe != nil || s.script == nil || s.script.open == nil {
		t.Fatalf("the dropdown was not handed back: probe %v, script %v", s.probe != nil, s.script)
	}
	if len(second.Actions) == 0 || second.Actions[len(second.Actions)-1].Kind != KindClick {
		t.Fatalf("the script did not open it: %s", kinds(second.Actions))
	}
	if second.Survey {
		t.Fatal("a survey was asked for while a dropdown is still being set")
	}
}

func TestAFailedActionEndsTheProbeAndTheModelLooks(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("filling", nil, chooseWithLabel(1, 500, 300, "Sponsorship", "No")),
		plan("again", nil, click(5, 5, nil)),
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	first := stepOK(t, a, id, surveyObservation(t))
	results := carriedOut(first.Actions)
	results[0].OK, results[0].Error = false, "the control could not be found"
	obs := observation(shot(t, 130))
	obs.Results = results
	stepOK(t, a, id, obs)
	if s, _ := a.sessions.get(id); s.probe != nil {
		t.Fatal("a failed batch left the probe running")
	}
	if len(model.requests) != 2 || !strings.Contains(lastText(model), "The last actions failed") {
		t.Fatalf("the model was not asked again with the reason (%d calls)", len(model.requests))
	}
}

func TestOnlyFastFillRunsProbeAndItCanBeTurnedOff(t *testing.T) {
	plain := &scriptedModel{replies: []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Sponsorship", "No"))}}
	a := newAgentWithScreen(t, plain, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, false), surveyObservation(t))
	if len(snapsOf(step.Actions)) != 0 {
		t.Fatal("a run without fast fill probed its dropdowns")
	}
	cfg := DefaultConfig()
	cfg.ProbeDropdowns = false
	b, bid := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Sponsorship", "No"))}, &fakeScreen{}, cfg)
	if got := stepOK(t, b, bid, surveyObservation(t)); len(snapsOf(got.Actions)) != 0 {
		t.Fatal("ProbeDropdowns off did not turn the probe off")
	}
}
