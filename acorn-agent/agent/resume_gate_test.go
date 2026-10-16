package agent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
)

// jdText is a page's text long enough to be asked about.
var jdText = strings.Repeat("We are hiring a Python application developer. You will build services and own them. ", 8)

func uploadPlan(message string, before ...map[string]any) string {
	actions := append(before, map[string]any{"kind": "upload", "x": 300, "y": 400})
	return plan(message, "notes", actions...)
}

func gateConfig() Config {
	cfg := DefaultConfig()
	cfg.FallbackResume = "data" // a folder newTestAgent creates
	return cfg
}

func withText(obs Observation, text string) Observation {
	obs.PageText = text
	return obs
}

func TestThePageTextIsReadForTheJobDescriptionOnce(t *testing.T) {
	decider := &fixedDecider{jd: 0.95, choice: "resume_0"}
	model := &scriptedModel{replies: []string{
		plan("reading", nil, click(1, 1, nil)), plan("next", nil, click(2, 2, nil)),
	}}
	a := newTestAgent(t, model, decider, gateConfig())
	id := start(t, a)
	stepOK(t, a, id, withText(observation(shot(t, 40)), jdText))
	obs := withText(observation(shot(t, 90)), jdText) // the same page again: not judged twice
	obs.Results = resultsFor("s1a", 1)
	stepOK(t, a, id, obs)
	if len(decider.states) != 1 {
		t.Fatalf("the page was judged %d times, want once", len(decider.states))
	}
	if !strings.Contains(decider.states[0], "Python application developer") {
		t.Fatalf("the decision model was not given the page text: %q", decider.states[0])
	}
}

func TestTheModelIsToldTheJobDescriptionOnItsFirstLook(t *testing.T) {
	decider := &fixedDecider{jd: 0.95}
	model := &scriptedModel{replies: []string{plan("one", nil, click(1, 1, nil))}}
	a := newTestAgent(t, model, decider, gateConfig())
	stepOK(t, a, start(t, a), withText(observation(shot(t, 40)), jdText))
	if text := lastText(model); !strings.Contains(text, "The job description, read from the page text") || !strings.Contains(text, "Python application developer") {
		t.Fatalf("the model is not told the description:\n%s", text)
	}
}

func TestAPageThatIsNotAJobDescriptionIsNotKept(t *testing.T) {
	decider := &fixedDecider{jd: 0.1}
	model := &scriptedModel{replies: []string{plan("one", nil, click(1, 1, nil)), plan("two", nil, click(2, 2, nil))}}
	a := newTestAgent(t, model, decider, gateConfig())
	id := start(t, a)
	stepOK(t, a, id, withText(observation(shot(t, 40)), jdText))
	obs := withText(observation(shot(t, 90)), "short")
	obs.Results = resultsFor("s1a", 1)
	stepOK(t, a, id, obs)
	if strings.Contains(lastText(model), "job description, read from") || len(decider.states) != 1 {
		t.Fatalf("judged %d, text:\n%s", len(decider.states), lastText(model))
	}
}

func TestTheResumeIsChosenFromTheWholeJobDescription(t *testing.T) {
	decider := &fixedDecider{jd: 0.95, choice: "resume_1"}
	model := &scriptedModel{replies: []string{uploadPlan("attaching"), plan("next", nil, click(1, 1, nil))}}
	a := newTestAgent(t, model, decider, gateConfig())
	id := start(t, a)
	step := stepOK(t, a, id, withText(observation(shot(t, 40)), jdText))
	if step.Status != StatusWorking || len(step.Actions) != 1 || step.Actions[0].Kind != KindUpload {
		t.Fatalf("with a job description the upload goes straight out: %+v", step)
	}
	if len(decider.choiceStates) != 1 || !strings.Contains(decider.choiceStates[0], "Job description:") ||
		!strings.Contains(decider.choiceStates[0], "Python application developer") {
		t.Fatalf("Jev was not given the description: %v", decider.choiceStates)
	}
}

func TestWithoutAJobDescriptionThePersonIsAskedAndTheDefaultIsUploaded(t *testing.T) {
	model := &scriptedModel{replies: []string{uploadPlan("attaching"), plan("next", nil, click(1, 1, nil))}}
	decider := &fixedDecider{jd: 0.1, choice: "resume_1"}
	a := newTestAgent(t, model, decider, gateConfig())
	id := start(t, a)

	ask := stepOK(t, a, id, observation(shot(t, 40)))
	if ask.Status != StatusAsk || ask.Ask == nil || len(ask.Actions) != 0 {
		t.Fatalf("ask = %+v", ask)
	}
	if !strings.Contains(ask.Ask.Question, "data") || len(ask.Ask.Options) != 2 ||
		ask.Ask.Options[0].ID != AnswerUseFallback || ask.Ask.Options[1].ID != AnswerChooseOwn {
		t.Fatalf("question = %+v", ask.Ask)
	}
	// A retry before the person answers asks again, and the model is not called.
	again := stepOK(t, a, id, observation(shot(t, 40)))
	if again.Status != StatusAsk || model.count() != 1 {
		t.Fatalf("again = %+v, model calls %d", again, model.count())
	}

	answered := observation(shot(t, 40))
	answered.Answer = AnswerUseFallback
	up := stepOK(t, a, id, answered)
	if up.Status != StatusWorking || len(up.Actions) != 1 || up.Actions[0].Kind != KindUpload ||
		!strings.HasSuffix(up.Actions[0].Resume, "Ada.pdf") || !strings.HasPrefix(up.Actions[0].Resume, "data/") ||
		*up.Actions[0].X != 300 || *up.Actions[0].Y != 400 || model.count() != 1 {
		t.Fatalf("upload = %+v, model calls %d", up, model.count())
	}
	if decider.calls > 0 && len(decider.choiceStates) != 0 {
		t.Fatal("the default is the person's choice: Jev must not pick")
	}

	// The model's next look says what happened.
	next := observation(shot(t, 140))
	next.Results = []ActionResult{{ID: up.Actions[0].ID, OK: true, Detail: "Ada.pdf, 3 bytes, through the picker"}}
	stepOK(t, a, id, next)
	text := lastText(model)
	for _, want := range []string{"No job description was found", "default résumé", "Ada.pdf"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
}

func TestThePersonIsAskedEveryTimeNotOnceForTheRun(t *testing.T) {
	model := &scriptedModel{replies: []string{uploadPlan("first"), uploadPlan("second")}}
	a := newTestAgent(t, model, &fixedDecider{jd: 0.1}, gateConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	yes := observation(shot(t, 40))
	yes.Answer = AnswerUseFallback
	up := stepOK(t, a, id, yes)
	look := observation(shot(t, 140))
	look.Results = []ActionResult{{ID: up.Actions[0].ID, OK: true}}
	second := stepOK(t, a, id, look)
	if second.Status != StatusAsk {
		t.Fatalf("a second upload must ask again: %+v", second)
	}
}

func TestChoosingOwnEndsTheRunForThePersonToUpload(t *testing.T) {
	model := &scriptedModel{replies: []string{uploadPlan("attaching")}}
	a := newTestAgent(t, model, &fixedDecider{jd: 0.1}, gateConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	own := observation(shot(t, 40))
	own.Answer = AnswerChooseOwn
	step := stepOK(t, a, id, own)
	if step.Status != StatusNeedPerson || step.Stop == nil || step.Stop.Reason != StopResumeChoice || step.Stop.Action == "" {
		t.Fatalf("step = %+v stop = %+v", step, step.Stop)
	}
	if _, err := a.Step(context.Background(), id, observation(shot(t, 90))); !errors.Is(err, ErrSessionOver) {
		t.Fatalf("the run is over: %v", err)
	}
}

func TestActionsBeforeTheHeldUploadRunFirst(t *testing.T) {
	model := &scriptedModel{replies: []string{uploadPlan("typing then attaching", click(10, 10, nil))}}
	a := newTestAgent(t, model, &fixedDecider{jd: 0.1}, gateConfig())
	id := start(t, a)
	first := stepOK(t, a, id, observation(shot(t, 40)))
	if first.Status != StatusWorking || len(first.Actions) != 1 || first.Actions[0].Kind != KindClick {
		t.Fatalf("first = %+v", first)
	}
	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1)
	if ask := stepOK(t, a, id, obs); ask.Status != StatusAsk {
		t.Fatalf("after the click the person is asked: %+v", ask)
	}
}

func TestNoQuestionWithoutADefaultOrWithOnlyOneResume(t *testing.T) {
	model := &scriptedModel{replies: []string{uploadPlan("attaching")}}
	a := newTestAgent(t, model, &fixedDecider{jd: 0.1, choice: "resume_0"}, DefaultConfig()) // no default set
	step := stepOK(t, a, start(t, a), observation(shot(t, 40)))
	if step.Status != StatusWorking || len(step.Actions) != 1 {
		t.Fatalf("without a default résumé nothing is asked: %+v", step)
	}
}

func TestADocumentThatIsNotAResumeIsNeverHeld(t *testing.T) {
	a := &Agent{}
	s := &session{fallback: "data", snap: applicant.Snapshot{Resumes: []applicant.Resume{
		{ID: "data/Ada.pdf", FileName: "Ada.pdf", Stack: "data", Format: "pdf"},
		{ID: "api/Ada.pdf", FileName: "Ada.pdf", Stack: "api", Format: "pdf"},
		{ID: "Cover Letter.pdf", FileName: "Cover Letter.pdf", Format: "pdf"},
	}}}
	if a.needsAsk(s, "Cover Letter") || !a.needsAsk(s, "") || !a.needsAsk(s, "api") {
		t.Fatal("only a résumé without a job description is held for the person")
	}
	s.jd = "a description"
	if a.needsAsk(s, "") {
		t.Fatal("with a job description nobody is asked")
	}
}

func TestAnAnswerThatIsNoneOfTheOptionsIsRefused(t *testing.T) {
	model := &scriptedModel{replies: []string{uploadPlan("attaching")}}
	a := newTestAgent(t, model, &fixedDecider{jd: 0.1}, gateConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	bad := observation(shot(t, 40))
	bad.Answer = "maybe"
	if _, err := a.Step(context.Background(), id, bad); !errors.Is(err, ErrBadObservation) {
		t.Fatalf("err = %v", err)
	}
}

func TestAFallbackThatIsNotAFolderStopsAStrictServerFromStarting(t *testing.T) {
	cfg := DefaultConfig()
	cfg.FallbackStrict = true
	cfg.FallbackResume = "No Such Folder"
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, cfg)
	_, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if !errors.Is(err, ErrFallbackResume) || !strings.Contains(err.Error(), "No Such Folder") || !strings.Contains(err.Error(), "data") {
		t.Fatalf("err = %v", err)
	}
}

func TestAClickOnAFileButtonWithoutAJobDescriptionAsksToo(t *testing.T) {
	model := &scriptedModel{replies: []string{attachClick()}}
	screen := &fakeScreen{fileKind: fileResume, fileSure: 0.99}
	a := newAgentWithScreen(t, model, &fixedDecider{jd: 0.1}, screen, gateConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = openedPicker("s1a1")
	step := stepOK(t, a, id, obs)
	if step.Status != StatusAsk || model.count() != 1 {
		t.Fatalf("step = %+v, model calls %d", step, model.count())
	}
	yes := observation(shot(t, 90))
	yes.Answer = AnswerUseFallback
	up := stepOK(t, a, id, yes)
	if len(up.Actions) != 1 || *up.Actions[0].X != 300 || *up.Actions[0].Y != 400 {
		t.Fatalf("upload = %+v", up)
	}
}

func namedUpload(name string) string {
	return plan("attaching", "notes", map[string]any{"kind": "upload", "x": 300, "y": 400, "resume": name})
}

func TestAResumeTheModelNamesIsIgnoredAndTheJobDescriptionChoosesIt(t *testing.T) {
	// The model names "backend"; Jev, given the whole description, chooses "data" (resume_1).
	decider := &fixedDecider{jd: 0.95, choice: "resume_1"}
	model := &scriptedModel{replies: []string{namedUpload("backend"), plan("next", nil, click(1, 1, nil))}}
	a := newTestAgent(t, model, decider, gateConfig())
	id := start(t, a)
	step := stepOK(t, a, id, withText(observation(shot(t, 40)), jdText))
	if len(step.Actions) != 1 || !strings.HasPrefix(step.Actions[0].Resume, "data/") {
		t.Fatalf("the model's pick must not win: %+v", step.Actions)
	}
	if len(decider.choiceStates) != 1 {
		t.Fatalf("Jev must choose; asked %d times", len(decider.choiceStates))
	}
	next := observation(shot(t, 90))
	next.Results = []ActionResult{{ID: step.Actions[0].ID, OK: true}}
	stepOK(t, a, id, next)
	if text := lastText(model); !strings.Contains(text, `You named the résumé "backend"`) || !strings.Contains(text, "Leave resume null") {
		t.Fatalf("the model is not told its pick was ignored:\n%s", text)
	}
}

func TestANamedFormatIsKeptWhenTheStackIsChosenByTheServer(t *testing.T) {
	// The stacks are "C# + React" (resume_0) and "Go" (resume_1); Jev chooses Go.
	for name, want := range map[string]string{
		"docx": "Go/Ada.docx", "pdf": "Go/Ada.pdf", "C# + React docx": "Go/Ada.docx", "": "Go/Ada.pdf", "C# + React": "Go/Ada.pdf",
	} {
		decider := &fixedDecider{jd: 0.95, choice: "resume_1"}
		model := &scriptedModel{replies: []string{namedUpload(name)}}
		a := stackAgent(t, model, decider, `{"name":"Ada"}`)
		step := stepOK(t, a, start(t, a), withText(observation(shot(t, 40)), jdText))
		if len(step.Actions) != 1 || step.Actions[0].Resume != want {
			t.Fatalf("named %q: %+v, want %s", name, step.Actions, want)
		}
	}
}

func TestACoverLetterTheModelNamesIsSentAsNamed(t *testing.T) {
	decider := &fixedDecider{jd: 0.95, choice: "resume_1"}
	model := &scriptedModel{replies: []string{namedUpload("Cover Letter")}}
	a := stackAgent(t, model, decider, `{"name":"Ada"}`)
	step := stepOK(t, a, start(t, a), withText(observation(shot(t, 40)), jdText))
	if len(step.Actions) != 1 || !strings.HasPrefix(step.Actions[0].Resume, "Cover Letter.") || len(decider.choiceStates) != 0 {
		t.Fatalf("step = %+v, Jev asked %d times", step.Actions, len(decider.choiceStates))
	}
}

func TestTheStackChosenOnceIsKeptForTheRunWhateverTheModelNames(t *testing.T) {
	decider := &fixedDecider{jd: 0.95, choice: "resume_1"}
	model := &scriptedModel{replies: []string{namedUpload("backend"), namedUpload("backend")}}
	a := newTestAgent(t, model, decider, gateConfig())
	id := start(t, a)
	first := stepOK(t, a, id, withText(observation(shot(t, 40)), jdText))
	next := observation(shot(t, 90))
	next.Results = []ActionResult{{ID: first.Actions[0].ID, OK: true}}
	second := stepOK(t, a, id, next)
	if !strings.HasPrefix(first.Actions[0].Resume, "data/") || !strings.HasPrefix(second.Actions[0].Resume, "data/") || len(decider.choiceStates) != 1 {
		t.Fatalf("first %+v second %+v, Jev asked %d times", first.Actions, second.Actions, len(decider.choiceStates))
	}
}

func TestAServerForManyPeopleOffersTheirPrimaryWhenTheirLibraryLacksTheConfiguredName(t *testing.T) {
	a := &Agent{cfg: Config{FallbackResume: "AI - Full Stack"}}
	resumes := []applicant.Resume{
		{ID: "1", Stack: "Python", Primary: true}, {ID: "2", Stack: "Go"},
	}
	if got, err := a.fallbackFor(resumes); err != nil || got != "Python" {
		t.Fatalf("no such name: %q %v, want the primary", got, err)
	}
	resumes = append(resumes, applicant.Resume{ID: "3", Stack: "ai - full stack"})
	if got, err := a.fallbackFor(resumes); err != nil || got != "ai - full stack" {
		t.Fatalf("the configured name wins, whatever its case: %q %v", got, err)
	}
	if got, err := (&Agent{}).fallbackFor([]applicant.Resume{{ID: "1", Stack: "Go"}}); err != nil || got != "" {
		t.Fatalf("no name and no primary: %q %v, want none", got, err)
	}
}

func TestAStrictServerOffersNothingWithoutAConfiguredName(t *testing.T) {
	a := &Agent{cfg: Config{FallbackStrict: true}}
	if got, err := a.fallbackFor([]applicant.Resume{{ID: "1", Stack: "Python", Primary: true}}); err != nil || got != "" {
		t.Fatalf("got %q %v", got, err)
	}
}
