package agent

import (
	"strconv"
	"strings"
	"testing"
)

func chooseAction(x, y float64, answer string, check any) map[string]any {
	return map[string]any{"kind": "choose", "x": x, "y": y, "text": answer, "check": check}
}

// sent describes a step's actions as "kind[:text or keys]" so a sequence reads at a glance.
func sent(actions []Action) []string {
	var out []string
	for _, action := range actions {
		switch action.Kind {
		case KindType:
			out = append(out, "type:"+action.Text)
		case KindKey:
			out = append(out, "key:"+action.Keys)
		case KindClick:
			out = append(out, "click@"+formatNumber(*action.X)+","+formatNumber(*action.Y))
		default:
			out = append(out, action.Kind)
		}
	}
	return out
}

func formatNumber(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func resultsOf(step Step) []ActionResult {
	var out []ActionResult
	for _, action := range step.Actions {
		out = append(out, ActionResult{ID: action.ID, OK: true})
	}
	return out
}

func TestSeveralDropdownsAreSetFromTheBottomUpWithOneModelCall(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("answering the dropdowns", nil,
			chooseAction(500, 200, "Male", nil), chooseAction(500, 600, "No", nil), chooseAction(500, 400, "East Asian", "the dropdowns show their answers")),
		plan("next", nil, click(5, 5, nil)),
	}}
	screen := &fakeScreen{options: []optionVerdict{{1, 0.95}, {3, 0.9}, {2, 0.99}}, verdicts: []screenVerdict{sure}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)

	step := stepOK(t, a, id, observation(shot(t, 40)))
	if got := strings.Join(sent(step.Actions), " "); got != "click@500,600" {
		t.Fatalf("first batch = %s", got)
	}
	// The list is open: the lowest dropdown's answer is the 1st option, then the next dropdown opens.
	obs := observation(shot(t, 80))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if got := strings.Join(sent(step.Actions), " "); got != "key:Home Enter click@500,400" {
		t.Fatalf("second batch = %s", got)
	}
	obs = observation(shot(t, 120))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if got := strings.Join(sent(step.Actions), " "); got != "key:Home ArrowDown ArrowDown Enter click@500,200" {
		t.Fatalf("third batch = %s", got)
	}
	obs = observation(shot(t, 160))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if got := strings.Join(sent(step.Actions), " "); got != "key:Home ArrowDown Enter" {
		t.Fatalf("last batch = %s", got)
	}
	if model.count() != 1 {
		t.Fatalf("the driving model was called %d times, want 1 for the whole screen", model.count())
	}
	for _, action := range step.Actions {
		if !isChooseID(action.ID) {
			t.Fatalf("action %q is not one the agent made", action.ID)
		}
	}
	// The run's own actions are not shown to the model as results of its plan.
	obs = observation(shot(t, 200))
	obs.Results = resultsOf(step)
	stepOK(t, a, id, obs)
	if text := lastText(model); strings.Contains(text, "ch") && strings.Contains(text, "s1ch") {
		t.Fatalf("the model was shown the agent's own results:\n%s", text)
	}
}

func TestTheAnswerIsTypedToNarrowAnOpenListThatHasNoSureOption(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("answering", nil, chooseAction(500, 300, "Prefer not to say", "it shows the answer"))}}
	screen := &fakeScreen{options: []optionVerdict{{0, 0}, {4, 0.9}}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if got := strings.Join(sent(step.Actions), " "); got != "click@500,300" {
		t.Fatalf("the control is opened first, nothing typed: %s", got)
	}
	obs := observation(shot(t, 80))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if got := strings.Join(sent(step.Actions), " "); got != "type:Prefer not to say" {
		t.Fatalf("the answer is typed to narrow the list: %s", got)
	}
	obs = observation(shot(t, 120))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if got := strings.Join(sent(step.Actions), " "); got != "key:Home ArrowDown ArrowDown ArrowDown Enter" {
		t.Fatalf("after narrowing, batch = %s", got)
	}
}

func TestADropdownNoOptionAnswersIsLeftOpenWholeForTheModel(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("answering", nil, chooseAction(500, 300, "Heterosexual", "it shows the answer"), click(9, 9, nil)),
		plan("picking it myself", nil, click(60, 60, nil)),
	}}
	screen := &fakeScreen{}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 80))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs) // nothing matched the open list: the answer is typed
	obs = observation(shot(t, 120))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs) // still nothing: the typing is taken back out
	if len(step.Actions) != 1 || !strings.HasPrefix(step.Actions[0].Keys, "Backspace") || len(strings.Fields(step.Actions[0].Keys)) != len("Heterosexual") {
		t.Fatalf("the typed answer should be cleared, got %v", sent(step.Actions))
	}
	obs = observation(shot(t, 160))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs) // the list is whole again and still nothing answers: the model looks
	if model.count() != 2 || len(step.Actions) != 1 || step.Actions[0].Kind != KindClick {
		t.Fatalf("model calls %d, step %+v", model.count(), step)
	}
	if text := lastText(model); !strings.Contains(text, `choose "Heterosexual"`) || !strings.Contains(text, "list is open") {
		t.Fatalf("the model was not told:\n%s", text)
	}
}

func TestWithoutADecisionModelADropdownIsClickTypeEnter(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("answering", nil, chooseAction(500, 300, "No", nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step := stepOK(t, a, start(t, a), observation(shot(t, 40)))
	if got := strings.Join(sent(step.Actions), " "); got != "click@500,300 type:No key:Enter" {
		t.Fatalf("actions = %s", got)
	}
}

func TestAChooseWithoutAPointOrAnAnswerIsRefused(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("answering", nil,
		map[string]any{"kind": "choose", "text": "No"}, map[string]any{"kind": "choose", "x": 10.0, "y": 10.0, "text": ""}, click(5, 5, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step := stepOK(t, a, start(t, a), observation(shot(t, 40)))
	if len(step.Actions) != 1 || len(step.Dropped) != 2 {
		t.Fatalf("actions %v dropped %v", sent(step.Actions), step.Dropped)
	}
}

func TestAFailedBatchCheckAsksForEveryWrongFieldAtOnceNotOneAtATime(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("filling", nil, typeAction("Ada", "first name shows Ada"), typeAction("Lovelace", "last name shows Lovelace"), typeAction("ada@example.com", "email shows ada@example.com")),
		plan("repairing", nil, click(10, 10, nil), typeAction("Lovelace", nil), click(20, 20, nil), typeAction("ada@example.com", nil)),
	}}
	screen := &fakeScreen{verdicts: []screenVerdict{notSure}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	first := stepOK(t, a, id, observation(shot(t, 40)))
	if len(first.Actions) != 3 {
		t.Fatalf("the three fills should run together, got %d actions", len(first.Actions))
	}
	obs := observation(shot(t, 90))
	obs.Results = resultsOf(first)
	step := stepOK(t, a, id, obs)
	if model.count() != 2 || len(step.Actions) != 4 {
		t.Fatalf("model calls %d, repair actions %d: all wrong fields should be fixed in one answer", model.count(), len(step.Actions))
	}
	text := lastText(model)
	if !strings.Contains(text, "every one that is wrong or empty together") || strings.Contains(text, "one action at a time") {
		t.Fatalf("the model was not asked for one repair answer:\n%s", text)
	}
}

func TestAClickThatOpenedNothingIsMovedOntoTheBoxBeforeAnythingIsTyped(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("answering", nil, chooseAction(500, 300, "Male", "it shows the answer"))}}
	screen := &fakeScreen{closedLooks: 1, options: []optionVerdict{{6, 0.95}}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 80))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs) // nothing opened
	if got := strings.Join(sent(step.Actions), " "); got != "click@500,312" {
		t.Fatalf("the click should move down onto the box, got %s", got)
	}
	obs = observation(shot(t, 120))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs) // now it is open
	if got := strings.Join(sent(step.Actions), " "); got != "key:Home ArrowDown ArrowDown ArrowDown ArrowDown ArrowDown Enter" {
		t.Fatalf("batch = %s", got)
	}
}

func TestADropdownThatNeverOpensIsNeverTypedInto(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("answering", nil, chooseAction(500, 300, "Male", "it shows the answer")),
		plan("clicking it myself", nil, click(60, 60, nil)),
	}}
	screen := &fakeScreen{closedLooks: 10}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	for i := 0; i < len(nudgeOffsets); i++ {
		obs := observation(shot(t, uint8(80+40*i)))
		obs.Results = resultsOf(step)
		step = stepOK(t, a, id, obs)
		for _, action := range step.Actions {
			if action.Kind == KindType {
				t.Fatalf("typed into a dropdown that never opened: %v", sent(step.Actions))
			}
		}
	}
	obs := observation(shot(t, 250))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if model.count() != 2 || len(step.Actions) != 1 || step.Actions[0].Kind != KindClick {
		t.Fatalf("after the tries the model must look; calls %d, step %+v", model.count(), step)
	}
	if text := lastText(model); !strings.Contains(text, `choose "Male"`) {
		t.Fatalf("the model was not told:\n%s", text)
	}
}
