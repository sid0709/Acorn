package agent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

// startWithPrefill opens a run that has the quick text pass turned on.
func startWithPrefill(t *testing.T, a *Agent) string {
	t.Helper()
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", Prefill: true})
	if err != nil {
		t.Fatal(err)
	}
	return started.SessionID
}

// pureTree is a page as the extension serializes it: Oak's one line per element.
const pureTree = `html[1]
  form[2] domId=2
    label[20] for=3 "Full name"
    input[3] domId=3 type=text name=full_name
    input[4] domId=4 type=email
    select[5] domId=5 name=country
      option[6] value=ca "Canada"
      option[7] value=us "United States"
    input[8] domId=8 type=radio name=auth
    input[9] domId=9 type=radio name=auth
    input[10] domId=10 type=checkbox name=newsletter
    input[11] domId=11 type=file
    div[12] domId=12 role=combobox
    input[13] domId=13 type=password
    button[14] domId=14 type=submit "Submit"`

func treeRequest() PrefillRequest {
	return PrefillRequest{URL: "https://jobs.example/apply", Title: "Apply", Tree: pureTree}
}

func planReply(fills ...string) string {
	return `{"fills":[` + strings.Join(fills, ",") + `]}`
}

func planned(index int, action, label, value string) string {
	return fmt.Sprintf(`{"element_index":%d,"action":%q,"expected_label":%q,"expected_role":"textbox","value":%q}`, index, action, label, value)
}

func classified(rows ...string) string {
	return `{"classifications":[` + strings.Join(rows, ",") + `]}`
}

func applicationAI(index int) string {
	return fmt.Sprintf(`{"element_index":%d,"kind":"application_ai"}`, index)
}

func TestPrefillKeepsOnlyFillsThatAreSafeToType(t *testing.T) {
	model := &scriptedModel{replies: []string{
		planReply(
			planned(3, "fill", "Full name", "Ada Lovelace"),
			planned(4, "fill", "Email", "ada@example.com"),
			planned(5, "fill", "Country", "United States"),
			planned(8, "select_radio", "Authorized to work?", "Yes"),
			planned(10, "select_radio", "Newsletter", "Sign me up"),
			planned(11, "fill", "Résumé", "resume.pdf"),             // a file input is not typed into
			planned(12, "fill", "Citizenship", "Canada"),            // a dropdown the page draws itself
			planned(13, "fill", "Password", "hunter2"),              // a password box
			planned(14, "fill", "Submit", "now"),                    // a button
			planned(8, "select_radio", "Authorized to work?", "No"), // answered twice
			planned(99, "fill", "Nowhere", "x"),                     // not in the tree
			planned(3, "select_radio", "Full name", "x"),            // a text box is not a radio button
			planned(4, "fill", "Email", ""),                         // nothing to put in
		),
		classified(),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := startWithPrefill(t, a)

	plan, err := a.Prefill(context.Background(), id, treeRequest())
	if err != nil {
		t.Fatal(err)
	}
	var kept []int
	for _, fill := range plan.Fills {
		kept = append(kept, fill.Ref)
	}
	if fmt.Sprint(kept) != "[3 4 5 8 10]" {
		t.Fatalf("kept %v, dropped %v", kept, plan.Dropped)
	}
	if len(plan.Dropped) != 8 {
		t.Fatalf("dropped = %v", plan.Dropped)
	}
	if plan.Fills[0].Value != "Ada Lovelace" || plan.Fills[0].Label != "Full name" || plan.Fills[0].Role != "textbox" {
		t.Fatalf("fill = %+v", plan.Fills[0])
	}
}

func TestPrefillNeverTypesTheAccountPassword(t *testing.T) {
	model := &scriptedModel{replies: []string{planReply(planned(3, "fill", "Full name", "my "+applicant.AccountPasswordToken)), classified()}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	plan, err := a.Prefill(context.Background(), startWithPrefill(t, a), treeRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Fills) != 0 || len(plan.Dropped) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPrefillSendsTheTreeAsTextWithTheApplicantAndCountsEveryCall(t *testing.T) {
	model := &scriptedModel{replies: []string{planReply(planned(3, "fill", "Full name", "Ada Lovelace")), classified()}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := startWithPrefill(t, a)
	plan, err := a.Prefill(context.Background(), id, treeRequest())
	if err != nil {
		t.Fatal(err)
	}
	if model.count() != 2 {
		t.Fatalf("model calls = %d: the plan, then the classification of its questions", model.count())
	}
	request := model.requests[0]
	for _, message := range request.Messages {
		if len(message.Images) != 0 {
			t.Fatal("the quick pass sent an image")
		}
	}
	if !strings.Contains(request.Messages[0].Text, "Ada Lovelace") {
		t.Fatalf("the applicant is not in the prompt:\n%s", request.Messages[0].Text)
	}
	user := request.Messages[1].Text
	if !strings.Contains(user, "input[3] domId=3 type=text name=full_name") || !strings.Contains(user, "Pure Tree:") {
		t.Fatalf("the page is not in the message:\n%s", user)
	}
	if !strings.Contains(user, "never identify as a bot") {
		t.Fatal("the reminder about who the applicant is is missing")
	}
	if plan.Usage.Calls != 2 || plan.Usage.Cost <= 0 {
		t.Fatalf("usage = %+v", plan.Usage)
	}
}

func TestThePlannerIsToldTheApplicantIsHumanWordForWord(t *testing.T) {
	system, err := prefillSystem(applicant.Snapshot{Profile: "{}"}, "2026-10-18")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"15. Applicant identity (overrides rules 6–7 only for the cases below): every answer is the human applicant from the profile. The applicant is not an AI, bot, automated agent, or automation tool.",
		"choose that control's no / have not / not applicable option. Never choose yes / used AI / automated.",
		"Never choose yes / I consent / I agree on those questions.",
		"Do not default to \"I have not used AI\" / \"I cannot provide examples\".",
	} {
		if !strings.Contains(system, want) {
			t.Fatalf("the prompt is missing Oak's rule: %q", want)
		}
	}
	if !strings.Contains(system, "{{PLACEHOLDER}}") {
		t.Fatal("the rule against placeholder tokens lost its example")
	}
}

func TestAYesToAQuestionAboutUsingAIOnThisApplicationBecomesANo(t *testing.T) {
	model := &scriptedModel{replies: []string{
		planReply(
			planned(8, "select_radio", "Did you use an AI tool to complete this application?", "Yes"),
			planned(9, "select_radio", "Do you use AI assistants in your daily work?", "Yes"),
			planned(10, "select_radio", "I consent to automated screening of my application", "I consent"),
			planned(3, "fill", "Full name", "Yes Man"), // not a question about AI: left alone
		),
		classified(applicationAI(8), applicationAI(10), `{"element_index":9,"kind":"workplace_ai"}`),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	plan, err := a.Prefill(context.Background(), startWithPrefill(t, a), treeRequest())
	if err != nil {
		t.Fatal(err)
	}
	values := map[int]string{}
	for _, fill := range plan.Fills {
		values[fill.Ref] = fill.Value
	}
	if values[8] != "No" || values[10] != "No" {
		t.Fatalf("the application questions were not answered as a human: %v", values)
	}
	if values[9] != "Yes" || values[3] != "Yes Man" {
		t.Fatalf("an ordinary question was rewritten: %v", values)
	}
	classifier := model.requests[1]
	if classifier.Messages[0].Text != identityPrompt || !strings.Contains(classifier.Messages[1].Text, "element_index: 8\nrole: textbox\nquestion: Did you use an AI tool") {
		t.Fatalf("the classifier was asked:\n%s\n%s", classifier.Messages[0].Text, classifier.Messages[1].Text)
	}
}

func TestAClassifierThatFailsLeavesTheAnswersAsPlanned(t *testing.T) {
	model := &scriptedModel{replies: []string{
		planReply(planned(8, "select_radio", "Did you use an AI tool?", "Yes")),
		"this is not json",
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	plan, err := a.Prefill(context.Background(), startWithPrefill(t, a), treeRequest())
	if err != nil {
		t.Fatalf("a failed classification must not fail the pass: %v", err)
	}
	if len(plan.Fills) != 1 || plan.Fills[0].Value != "Yes" {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestOnlyAYesIsMadeANo(t *testing.T) {
	for value, want := range map[string]string{
		"Yes": "No", " yes ": "No", "I consent": "No", "I agree to this": "No", "agree": "No", "True": "No",
		"No": "No", "Not at all": "Not at all", "": "", "Maybe": "Maybe",
	} {
		if got := rewriteYes(value); got != want {
			t.Fatalf("rewriteYes(%q) = %q, want %q", value, got, want)
		}
	}
}

func TestPrefillIsOffUnlessTheRunTurnedItOn(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	if _, err := a.Prefill(context.Background(), id, treeRequest()); !errors.Is(err, ErrPrefillOff) {
		t.Fatalf("err = %v", err)
	}
	s, _ := a.sessions.get(id)
	if strings.Contains(s.system, "first draft") {
		t.Fatal("a run without the quick pass is told of it")
	}
}

func TestARunWithThePassIsToldItsDraftIsNotProof(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	s, _ := a.sessions.get(startWithPrefill(t, a))
	if !strings.Contains(s.system, "A first draft in the fields") || !strings.Contains(s.system, "not proof") {
		t.Fatal("the model is not told how to treat the draft")
	}
}

func TestPrefillStopsAtTheMostPassesARunMayMake(t *testing.T) {
	cfg := DefaultConfig()
	cfg.MaxPrefills = 1
	model := &scriptedModel{replies: []string{planReply(), planReply()}}
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := startWithPrefill(t, a)
	if _, err := a.Prefill(context.Background(), id, treeRequest()); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Prefill(context.Background(), id, treeRequest()); !errors.Is(err, ErrPrefillLimit) {
		t.Fatalf("err = %v", err)
	}
	if model.count() != 1 {
		t.Fatalf("model calls = %d", model.count())
	}
}

func TestPrefillWaitsWhileTheModelsOwnPlanIsStillBeingCarriedOut(t *testing.T) {
	model := &scriptedModel{replies: []string{planReply()}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := startWithPrefill(t, a)
	s, _ := a.sessions.get(id)
	s.mu.Lock()
	s.plan = []chunk{{}}
	s.mu.Unlock()
	if _, err := a.Prefill(context.Background(), id, treeRequest()); !errors.Is(err, ErrPrefillBusy) {
		t.Fatalf("err = %v", err)
	}
	if model.count() != 0 || s.prefills != 0 {
		t.Fatalf("a refused pass was charged: model calls %d, passes %d", model.count(), s.prefills)
	}
	s.mu.Lock()
	s.plan = nil
	s.mu.Unlock()
	if _, err := a.Prefill(context.Background(), id, treeRequest()); err != nil {
		t.Fatalf("once the plan is done: %v", err)
	}
}

func TestPrefillRefusesAPageItCannotRead(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	id := startWithPrefill(t, a)
	cases := map[string]string{
		"empty":    "  \n",
		"no lines": "just some words\nand more words",
		"too big":  "div[1]\n" + strings.Repeat("x", maxPrefillTreeChars),
	}
	for name, tree := range cases {
		if _, err := a.Prefill(context.Background(), id, PrefillRequest{Tree: tree}); !errors.Is(err, ErrBadPrefill) {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
}

func TestAPassTheModelFailsAtIsReportedAndChangesNothingForTheRun(t *testing.T) {
	model := &scriptedModel{replies: []string{"not json at all"}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := startWithPrefill(t, a)
	if _, err := a.Prefill(context.Background(), id, treeRequest()); err == nil {
		t.Fatal("a refused answer was accepted")
	}
	s, _ := a.sessions.get(id)
	if s.finished || s.step != 0 {
		t.Fatalf("the run changed: finished %v, step %d", s.finished, s.step)
	}
}

func TestTheNextLookIsToldWhatThePassFilledAndMarksTheFormFound(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("checking the draft", nil, click(5, 5, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := startWithPrefill(t, a)
	obs := observation(shot(t, 40))
	obs.Prefill = &PrefillReport{
		Filled: []PrefillLine{{Label: "Full name", Value: "Ada Lovelace"}},
		Failed: []PrefillLine{{Label: "Country", Error: "the page would not take it"}},
	}
	stepOK(t, a, id, obs)
	text := lastText(model)
	for _, want := range []string{`Full name = "Ada Lovelace"`, "Could not fill: Country (the page would not take it)", "not proof"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the look is missing %q:\n%s", want, text)
		}
	}
	if s, _ := a.sessions.get(id); !s.formReady {
		t.Fatal("fields were typed, so the application form was found")
	}
}

func TestAReportFromARunWithoutThePassIsIgnored(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("looking", nil, click(5, 5, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	obs := observation(shot(t, 40))
	obs.Prefill = &PrefillReport{Filled: []PrefillLine{{Label: "Full name", Value: "Ada"}}}
	stepOK(t, a, start(t, a), obs)
	if strings.Contains(lastText(model), "quick pass") {
		t.Fatal("a run that did not turn the pass on was told of it")
	}
}

func TestThePassNoteIsBoundedAndSaysHowManyMore(t *testing.T) {
	report := &PrefillReport{}
	for i := 0; i < maxPrefillNoteLines+5; i++ {
		report.Filled = append(report.Filled, PrefillLine{Label: fmt.Sprintf("Field %d", i), Value: "x"})
	}
	note := prefillNote(report)
	if !strings.Contains(note, "and 5 more") || strings.Contains(note, fmt.Sprintf("Field %d =", maxPrefillNoteLines+1)) {
		t.Fatalf("note = %s", note)
	}
	if prefillNote(&PrefillReport{}) != "" || prefillNote(nil) != "" {
		t.Fatal("a pass that did nothing is told to the model")
	}
}
