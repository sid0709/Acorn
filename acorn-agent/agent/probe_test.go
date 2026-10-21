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

	// The list is closed, opened again, the answer typed, a picture taken, and the list closed again.
	if len(snapsOf(second.Actions)) != 1 {
		t.Fatalf("no second picture: %s", kinds(second.Actions))
	}
	if got := keysOf(second.Actions); len(got) != 1 || got[0] != probeEscape {
		t.Fatalf("keys = %v: the typed list is not closed after its picture, and would hang over the dropdown below", got)
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
	if got := keysOf(third.Actions); len(got) != 1 || got[0] != optionKeys(1) {
		t.Fatalf("keys = %v: the answer is picked", got)
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
	// The first picture shows no list (a search box, or a list that has not drawn), though the click gave
	// the box focus. Position 0 keeps pickOptionFrom from treating a sure option as proof the list is open.
	screen := &fakeScreen{closedLooks: 1}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Country", "United States"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sends(t, a, id, first.Actions, map[int]*Focus{0: {Tag: "input", Type: "text", Label: "Country"}})
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

// clickYs are the places the clicks of a batch aim at, in order.
func clickYs(actions []Action) []float64 {
	var out []float64
	for _, action := range actions {
		if action.Kind == KindClick && action.Y != nil {
			out = append(out, *action.Y)
		}
	}
	return out
}

func TestTheListsAreOpenedFromTheTopDownAndPickedFromTheBottomUp(t *testing.T) {
	reply := plan("filling", nil,
		chooseWithLabel(1, 500, 500, "Gender", "Male"),
		chooseWithLabel(1, 500, 100, "Country", "No"),
		chooseWithLabel(1, 500, 300, "Sponsorship", "No"),
	)
	screen := &fakeScreen{optionByAnswer: map[string]optionVerdict{"No": {1, 0.95}, "Male": {3, 0.95}}}
	a, id := newProbeAgent(t, []string{reply}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	if got := clickYs(first.Actions); len(got) != 3 || got[0] != 100 || got[1] != 300 || got[2] != 500 {
		t.Fatalf("the lists were opened at %v, want from the top down: the pass that picks then begins where this one ends", got)
	}
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	if got := clickYs(second.Actions); len(got) != 3 || got[0] != 500 || got[1] != 300 || got[2] != 100 {
		t.Fatalf("the picks were made at %v, want from the bottom up: a pick can add a message that moves what is below it", got)
	}
}

func TestDropdownsOnDifferentScreensAreHandledInTheOrderTheyAreOnThePage(t *testing.T) {
	// A point's y is its place on its own screen: 100 on the screen scrolled to 680 is lower on the page than
	// 700 on the screen scrolled to 0.
	reply := plan("filling", nil,
		chooseWithLabel(1, 500, 700, "Gender", "Male"),
		chooseWithLabel(2, 500, 100, "Race", "Asian"),
		chooseWithLabel(1, 500, 600, "Country", "No"),
	)
	a, id := newProbeAgent(t, []string{reply}, &fakeScreen{}, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	var order []float64
	for _, action := range first.Actions {
		if action.Kind == KindClick && action.ScrollTo != nil {
			order = append(order, *action.ScrollTo+*action.Y)
		}
	}
	if len(order) != 3 || order[0] != 600 || order[1] != 700 || order[2] != 780 {
		t.Fatalf("opened at page positions %v, want 600, 700, 780 (top down, across screens)", order)
	}
}

func TestNoSurveyIsAskedForWhileARunOfDropdownsIsHalfDone(t *testing.T) {
	screen := &fakeScreen{optionByAnswer: map[string]optionVerdict{"No": {1, 0.95}, "Male": {3, 0.95}}}
	a, id := newProbeAgent(t, []string{dropdowns("No", "Male")}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	if first.Survey {
		t.Fatal("the first batch of a run of dropdowns is followed by a survey that nothing reads: the run goes on without the model")
	}
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	if !second.Survey {
		t.Fatal("the run's last batch is not followed by a survey")
	}
}

func TestARefusedPointStillGetsItsSurveyAfterTheDropdownsAreSet(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"),
		chooseWithLabel(1, 500, 300, "Sponsorship", "No"),
	)
	screen := &fakeScreen{wrongPoints: []string{"First Name"}, optionByAnswer: map[string]optionVerdict{"No": {1, 0.95}}}
	a, id := newProbeAgent(t, []string{reply}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	if first.Survey {
		t.Fatal("a survey was asked for in the middle of the run")
	}
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	if !second.Survey {
		t.Fatal("the survey the refused point asked for was lost")
	}
	s, _ := a.sessions.get(id)
	if s.surveyAgain {
		t.Fatal("the ask for a survey is still pending after the survey was asked for")
	}
}

// sendsLists is the extension sending the pictures of a batch's snap actions with the options the page
// names for each open list (by the snap's place in the batch; a list left out is one the page named nothing for).
func sendsLists(t *testing.T, a *Agent, id string, actions []Action, lists map[int][]string) {
	t.Helper()
	for i, snap := range snapsOf(actions) {
		upload := ShotUpload{Kind: ShotSnap, ID: snap.ID, Screenshot: shot(t, uint8(50+10*i))}
		if options, ok := lists[i]; ok {
			upload.List = &OpenList{Options: options}
		}
		if err := a.ReceiveShot(context.Background(), id, upload); err != nil {
			t.Fatal(err)
		}
	}
}

// askedAboutPictures counts the times the screen was asked which option of a pictured list answers.
func askedAboutPictures(screen *fakeScreen) int {
	n := 0
	for _, request := range screen.requests {
		if _, asked := request.Questions[askOption]; asked {
			n++
		}
	}
	return n
}

func TestAListThePageNamesIsPickedByTheOptionThatIsExactlyTheAnswerWithNoModel(t *testing.T) {
	screen := &fakeScreen{}
	a, id := newProbeAgent(t, []string{dropdowns("No", "Male")}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	// The lists are opened from the top down: the first picture is the sponsorship's, the second the gender's.
	sendsLists(t, a, id, first.Actions, map[int][]string{0: {"Yes", "No"}, 1: {"Female", "Male", "Non-binary"}})
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	if picked := keysOf(second.Actions); len(picked) != 2 || picked[0] != optionKeys(2) || picked[1] != optionKeys(2) {
		t.Fatalf("keys = %v, want each answer picked by its place among the options the page named", picked)
	}
	if askedAboutPictures(screen) != 0 || screen.listedRequests != 0 {
		t.Fatalf("the decision model was asked (%d about pictures, %d about text) though each option was exactly the answer", askedAboutPictures(screen), screen.listedRequests)
	}
	if !second.Survey {
		t.Fatal("the run's last batch is not followed by a survey")
	}
}

func TestAListThePageNamesIsReadAsTextWhenNoOptionIsExactlyTheAnswer(t *testing.T) {
	screen := &fakeScreen{listedWeights: map[string]float64{"option_1": 0.85, "option_2": 0.1, optionNone: 0.05}}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Race", "Asian"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sendsLists(t, a, id, first.Actions, map[int][]string{0: {"Black or of African descent", "East Asian", "South Asian"}})
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	if picked := keysOf(second.Actions); len(picked) != 1 || picked[0] != optionKeys(2) {
		t.Fatalf("keys = %v, want the second option, which the model chose from the text", picked)
	}
	if askedAboutPictures(screen) != 0 || screen.listedRequests != 1 {
		t.Fatalf("asked %d about pictures and %d about text, want the text read once", askedAboutPictures(screen), screen.listedRequests)
	}
	for _, action := range second.Actions {
		if action.Kind == KindType {
			t.Fatal("the answer was typed into a list that shows its options")
		}
	}
}

func TestAnOptionThatLeadsClearlyIsTakenThoughTheModelIsNotSureOfIt(t *testing.T) {
	screen := &fakeScreen{listedWeights: map[string]float64{"option_1": 0.55, "option_2": 0.2, optionNone: 0.25}}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Race", "Asian"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sendsLists(t, a, id, first.Actions, map[int][]string{0: {"Black or of African descent", "East Asian", "South Asian"}})
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	if picked := keysOf(second.Actions); len(picked) != 1 || picked[0] != optionKeys(2) {
		t.Fatalf("keys = %v, want the option that leads clearly (0.55 against 0.2)", picked)
	}
	cfg := DefaultConfig()
	cfg.OptionAccept = 0
	torn := &fakeScreen{listedWeights: map[string]float64{"option_1": 0.55, "option_2": 0.2, optionNone: 0.25}}
	b, bid := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Race", "Asian")), plan("again", nil, click(5, 5, nil))}, torn, cfg)
	first = stepOK(t, b, bid, surveyObservation(t))
	sendsLists(t, b, bid, first.Actions, map[int][]string{0: {"Black or of African descent", "East Asian", "South Asian"}})
	obs = observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	if second := stepOK(t, b, bid, obs); len(keysOf(second.Actions)) != 0 {
		t.Fatalf("with the lead rule off, keys = %v: an option the model is not sure of was taken", keysOf(second.Actions))
	}
}

func TestADropdownNoOptionOfWhichAnswersIsLeftToTheModelWithItsOptionsAndTheSendIsHeld(t *testing.T) {
	options := []string{"Black or of African descent", "East Asian", "Hispanic, Latinx or of Spanish Origin", "South Asian", "Southeast Asian"}
	screen := &fakeScreen{listedWeights: map[string]float64{"option_1": 0.4, "option_3": 0.3, "option_4": 0.2, optionNone: 0.1}}
	model := &scriptedModel{replies: []string{
		plan("filling", nil,
			chooseWithLabel(1, 500, 300, "Race", "Asian"),
			labelled(1, 100, 600, "Phone"), typeAction("555", nil),
			committing(3, 900, 700, "Submit application"),
		),
		plan("choosing", nil, chooseWithLabel(1, 500, 300, "Race", "East Asian")),
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startFast(t, a, true)
	first := stepOK(t, a, id, surveyObservation(t))
	sendsLists(t, a, id, first.Actions, map[int][]string{0: options})
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	if len(keysOf(second.Actions)) != 0 {
		t.Fatalf("keys = %v: nothing is picked in a list no option of which answers", keysOf(second.Actions))
	}
	for _, action := range second.Actions {
		if action.Kind == KindType && action.Text != "555" {
			t.Fatalf("the answer was typed into the list: %s", kinds(second.Actions))
		}
		if action.Commit != "" || (action.Kind == KindClick && action.ScrollTo != nil && *action.ScrollTo == 1360) {
			t.Fatalf("the click that sends the page went out with a dropdown unset: %s", kinds(second.Actions))
		}
	}
	var typed bool
	for _, action := range second.Actions {
		typed = typed || (action.Kind == KindType && action.Text == "555")
	}
	if !typed {
		t.Fatalf("the rest of the plan did not go on: %s", kinds(second.Actions))
	}
	if !second.Survey {
		t.Fatal("the model is not shown the page again to choose")
	}
	s, _ := a.sessions.get(id)
	joined := strings.Join(s.notes, "\n")
	if !strings.Contains(joined, `choose "Asian"`) || !strings.Contains(joined, `2 "East Asian"`) || !strings.Contains(joined, `"Race"`) || !strings.Contains(joined, "on screen 1") {
		t.Fatalf("the model is not told the options: %v", s.notes)
	}
	if !strings.Contains(joined, "Submit application") || !strings.Contains(joined, "not complete") {
		t.Fatalf("the model is not told the click that sends the page was held back: %v", s.notes)
	}
	if s.probe != nil || s.script != nil {
		t.Fatal("the run is over but the session still holds it")
	}
	// The model answers in the option's own words: it is picked with no question asked.
	third := stepOK(t, a, id, surveyObservation(t))
	sendsLists(t, a, id, third.Actions, map[int][]string{0: options})
	obs = observation(shot(t, 170))
	obs.Results = carriedOut(third.Actions)
	fourth := stepOK(t, a, id, obs)
	if picked := keysOf(fourth.Actions); len(picked) != 1 || picked[0] != optionKeys(2) {
		t.Fatalf("keys = %v, want East Asian picked by its place", picked)
	}
	if screen.listedRequests != 1 {
		t.Fatalf("the decision model was asked %d times about the text, want once: the model's own words need no question", screen.listedRequests)
	}
}

func TestAnOpenListWithNoOptionsIsTypedAndReadAgainFromThePage(t *testing.T) {
	screen := &fakeScreen{}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Country", "United States"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	// The page says a list is open with nothing in it: a box that searches as one types.
	sendsLists(t, a, id, first.Actions, map[int][]string{0: {}})
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	var typed bool
	for _, action := range second.Actions {
		typed = typed || (action.Kind == KindType && action.Text == "United States")
	}
	if !typed || len(snapsOf(second.Actions)) != 1 {
		t.Fatalf("the answer was not typed and the list read again: %s", kinds(second.Actions))
	}
	sendsLists(t, a, id, second.Actions, map[int][]string{0: {"United States", "United States Minor Outlying Islands"}})
	obs = observation(shot(t, 170))
	obs.Results = carriedOut(second.Actions)
	third := stepOK(t, a, id, obs)
	if got := keysOf(third.Actions); len(got) != 1 || got[0] != optionKeys(1) {
		t.Fatalf("keys = %v: the first of the narrowed options is picked", got)
	}
	if askedAboutPictures(screen) != 0 || screen.listedRequests != 0 {
		t.Fatalf("the decision model was asked (%d pictures, %d text) though the page named the options and one was the answer", askedAboutPictures(screen), screen.listedRequests)
	}
}

func TestAClickThatReachedNothingIsMadeAgainLowerBeforeAnythingIsTyped(t *testing.T) {
	// The first picture shows no list and the page says nothing has focus: the click landed beside the
	// dropdown. The second, 12 px lower, opens it; the pick then clicks where the list opened.
	screen := &fakeScreen{closedLooks: 1, options: []optionVerdict{{3, 0.95}}}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Gender", "Male"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	for _, action := range second.Actions {
		if action.Kind == KindType {
			t.Fatalf("typed into a dropdown whose click reached nothing: %s", kinds(second.Actions))
		}
	}
	if ys := clickYs(second.Actions); len(ys) != 1 || ys[0] != 300+nudgeOffsets[0] {
		t.Fatalf("clicks at %v, want one %v px lower than the model's point", ys, nudgeOffsets[0])
	}
	if len(snapsOf(second.Actions)) != 1 || keysOf(second.Actions)[0] != probeEscape {
		t.Fatalf("the lower click was not photographed and closed: %s", kinds(second.Actions))
	}
	sends(t, a, id, second.Actions, nil)
	obs = observation(shot(t, 170))
	obs.Results = carriedOut(second.Actions)
	third := stepOK(t, a, id, obs)
	if ys := clickYs(third.Actions); len(ys) != 1 || ys[0] != 300+nudgeOffsets[0] {
		t.Fatalf("the pick clicks at %v, want where the list opened", ys)
	}
	if got := keysOf(third.Actions); len(got) != 1 || got[0] != optionKeys(3) {
		t.Fatalf("keys = %v, want the answer picked", got)
	}
	if !third.Survey {
		t.Fatal("the run's last batch is not followed by a survey")
	}
}

func TestAClickMadeAgainLowerThatStillReachesNothingIsTyped(t *testing.T) {
	// Lower, the list is still not open and nothing has focus: the answer is typed, as for a search box,
	// and the dropdown is not nudged for ever.
	screen := &fakeScreen{closedLooks: 2, options: []optionVerdict{{1, 0.95}}}
	a, id := newProbeAgent(t, []string{plan("filling", nil, chooseWithLabel(1, 500, 300, "Country", "Canada"))}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Results = carriedOut(first.Actions)
	second := stepOK(t, a, id, obs)
	sends(t, a, id, second.Actions, nil)
	obs = observation(shot(t, 170))
	obs.Results = carriedOut(second.Actions)
	third := stepOK(t, a, id, obs)
	var typed bool
	for _, action := range third.Actions {
		typed = typed || (action.Kind == KindType && action.Text == "Canada")
	}
	if !typed || len(snapsOf(third.Actions)) != 1 {
		t.Fatalf("the answer was not typed after the lower click: %s", kinds(third.Actions))
	}
	if ys := clickYs(third.Actions); len(ys) != 1 || ys[0] != 300+nudgeOffsets[0] {
		t.Fatalf("typed at %v, want the lower point", ys)
	}
}
