package selector

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// scriptedDecider answers each question by key from a fixed table and keeps the request.
type scriptedDecider struct {
	answers map[string]jev.Answer
	last    jev.Request
}

func (s *scriptedDecider) Decide(_ context.Context, req jev.Request) (jev.Response, error) {
	s.last = req
	return jev.Response{Answers: s.answers}, nil
}

func (s *scriptedDecider) Model() string { return "scripted" }

func yes(p float64) *float64 { return &p }

var formControls = []Control{
	{ID: 10, Tag: "button", Text: "Back"},
	{ID: 11, Tag: "button", Text: "Save and continue", InForm: true},
}

func TestReadPagePicksTheForwardControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm, Confidence: 0.9},
		controlQuestion:  {Choice: "control_1", Confidence: 0.8, Probabilities: map[string]float64{"control_0": 0.1, "control_1": 0.8}},
		finalQuestion:    {Noul: yes(0.2)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Your details", Intent: IntentAdvance, Controls: formControls})
	if err != nil {
		t.Fatal(err)
	}
	if read.Kind != KindForm || read.Control == nil || read.Control.ID != 11 || read.Control.Role != RoleNext {
		t.Fatalf("read = %+v control = %+v, want a form with control 11 as next", read, read.Control)
	}
	if got := len(decider.last.Questions[controlQuestion].Criteria); got != len(formControls)+1 {
		t.Fatalf("control criteria = %d, want controls plus none", got)
	}
	if !strings.Contains(decider.last.State, "Save and continue") {
		t.Fatalf("state does not list the controls:\n%s", decider.last.State)
	}
}

func TestReadPageSubmitOnTheLastStep(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		controlQuestion:  {Choice: "control_1"},
		finalQuestion:    {Noul: yes(0.95)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Review", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.Control == nil || read.Control.Role != RoleSubmit {
		t.Fatalf("read = %+v err = %v, want submit", read, err)
	}
}

func TestReadPageApplyOnAPosting(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindPosting},
		controlQuestion:  {Choice: "control_0"},
		finalQuestion:    {Noul: yes(0.9)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Senior Go Engineer", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Control == nil || read.Control.Role != RoleApply || read.Control.ID != 10 {
		t.Fatalf("read = %+v err = %v, want apply on control 10", read, err)
	}
}

func TestReadPageNoControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindConfirmation},
		controlQuestion:  {Choice: noControlKey},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Thank you", Controls: formControls})
	if err != nil || read.Kind != KindConfirmation || read.Control != nil {
		t.Fatalf("read = %+v err = %v, want a confirmation with no control", read, err)
	}
}

func TestReadPageUnknownKindIsOther(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{pageKindQuestion: {Choice: "mystery"}}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "x"})
	if err != nil || read.Kind != KindOther {
		t.Fatalf("read = %+v err = %v, want other", read, err)
	}
}

func TestReadPageRejectsAnEmptyPage(t *testing.T) {
	if _, err := New(&scriptedDecider{}).ReadPage(context.Background(), PageQuery{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestDiagnoseNamesAReason(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		diagnoseQuestion: {Choice: FailBotCheck, Confidence: 0.7},
	}}
	failure, err := New(decider).Diagnose(context.Background(), FailureQuery{Stage: "advance", Evidence: []string{"Please verify you are human"}})
	if err != nil || failure.Reason != FailBotCheck {
		t.Fatalf("failure = %+v err = %v, want bot_check", failure, err)
	}
	if !strings.Contains(decider.last.State, "verify you are human") {
		t.Fatalf("state is missing the evidence:\n%s", decider.last.State)
	}
}

func TestDiagnoseUnknownReasonIsOther(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{diagnoseQuestion: {Choice: "??"}}}
	failure, err := New(decider).Diagnose(context.Background(), FailureQuery{Evidence: []string{"x"}})
	if err != nil || failure.Reason != FailOther {
		t.Fatalf("failure = %+v err = %v, want other", failure, err)
	}
}

func TestReadPageFallsBackToTheMostProbableControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		controlQuestion: {Choice: noControlKey, Probabilities: map[string]float64{
			noControlKey: 0.7, "control_0": 0.05, "control_1": 0.25,
		}},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Your details", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.Control != nil || read.Fallback == nil || read.Fallback.ID != 11 {
		t.Fatalf("read = %+v err = %v, want no pick and a fallback on control 11", read, err)
	}
}

func TestReadPageNoFallbackOffTheApplication(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindOther},
		controlQuestion:  {Choice: noControlKey, Probabilities: map[string]float64{"control_1": 0.4}},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Search results", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Fallback != nil {
		t.Fatalf("read = %+v err = %v, want no fallback off the application", read, err)
	}
}

// A posting whose apply control Jev doubted (worded unlike most) still offers it,
// so the run tries it before saying the posting has no way to apply.
func TestReadPagePostingFallsBackToItsLikeliestControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindPosting},
		controlQuestion: {Choice: noControlKey, Probabilities: map[string]float64{
			noControlKey: 0.6, "control_0": 0.05, "control_1": 0.35,
		}},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Senior Go Engineer", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Control != nil || read.Fallback == nil || read.Fallback.ID != 11 || read.Fallback.Role != RoleApply {
		t.Fatalf("read = %+v err = %v, want an apply fallback on control 11", read, err)
	}
}

func TestReadPageAccountStepOffersAGuestPath(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindAccount},
		controlQuestion:  {Choice: "control_1"},
		finalQuestion:    {Noul: yes(0.9)},
		guestQuestion:    {Noul: yes(0.95)},
		accountQuestion:  {Choice: AccountChoose},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Already have an account?", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Kind != KindAccount || !read.Guest || read.Control == nil || read.Control.Role != RoleNext {
		t.Fatalf("read = %+v control = %+v err = %v, want a guest account step moving on with next", read, read.Control, err)
	}
}

var guestChoiceControls = []Control{
	{ID: 20, Tag: "button", Text: "Sign Into My Account", Dialog: "dialog"},
	{ID: 21, Tag: "button", Text: "Create an Account + Apply", Dialog: "dialog"},
	{ID: 22, Tag: "button", Text: "Quick Apply (No Account)", Dialog: "dialog"},
}

// The guest control is asked apart from the forward pick: an account goal that
// pulls the forward pick onto an account form never moves the guest click.
func TestReadPageNamesTheGuestControlApartFromTheAccountGoal(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion:     {Choice: KindAccount},
		controlQuestion:      {Choice: "control_1", Confidence: 0.7},
		guestQuestion:        {Noul: yes(0.9)},
		guestControlQuestion: {Choice: "control_2", Confidence: 0.9},
		accountQuestion:      {Choice: AccountChoose},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{
		Text: "How would you like to apply?", Intent: IntentStart, Controls: guestChoiceControls, AccountGoal: AccountCreate,
	})
	if err != nil || read.GuestControl == nil || read.GuestControl.ID != 22 || read.GuestControl.Role != RoleNext {
		t.Fatalf("read = %+v guest = %+v err = %v, want control 22 as the guest control", read, read.GuestControl, err)
	}
	if read.Control == nil || read.Control.ID != 21 {
		t.Fatalf("control = %+v, want the forward pick kept as answered", read.Control)
	}
	if got := len(decider.last.Questions[guestControlQuestion].Criteria); got != len(guestChoiceControls)+1 {
		t.Fatalf("guest criteria = %d, want controls plus none", got)
	}
	if !strings.Contains(decider.last.State, "only when it offers no way to go on without an account") {
		t.Fatalf("state does not scope the account goal to pages with no guest path:\n%s", decider.last.State)
	}
}

func TestReadPageNoGuestControlWithoutAGuestPath(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion:     {Choice: KindAccount},
		controlQuestion:      {Choice: "control_1"},
		guestQuestion:        {Noul: yes(0.1)},
		guestControlQuestion: {Choice: "control_2"},
		accountQuestion:      {Choice: AccountChoose},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Sign in", Intent: IntentStart, Controls: guestChoiceControls})
	if err != nil || read.Guest || read.GuestControl != nil {
		t.Fatalf("read = %+v guest = %+v err = %v, want no guest control", read, read.GuestControl, err)
	}
}

// The application a guest path opened can leave its guest control in the page;
// off an account step the forward pick moves the run, never the guest control.
func TestReadPageNoGuestControlOffAnAccountStep(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion:     {Choice: KindForm},
		controlQuestion:      {Choice: "control_1"},
		guestQuestion:        {Noul: yes(0.9)},
		guestControlQuestion: {Choice: "control_2"},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "My application", Intent: IntentAdvance, Controls: guestChoiceControls})
	if err != nil || read.GuestControl != nil {
		t.Fatalf("read = %+v guest = %+v err = %v, want no guest control on a form", read, read.GuestControl, err)
	}
}

// A dialog left open beneath a newer one is not the step: the state names the dialog on top.
func TestPageStateNamesTheDialogOnTop(t *testing.T) {
	controls := []Control{
		{ID: 1, Tag: "button", Text: "Go on", Dialog: "Choose how to apply", Covered: true},
		{ID: 2, Tag: "button", Text: "Send", Dialog: "My application"},
	}
	state := pageState(PageQuery{}, controls)
	if !strings.Contains(state, `dialog is over the page: "My application"`) {
		t.Fatalf("state does not name the dialog on top:\n%s", state)
	}
}

func TestReadPageAccountStepFallsBack(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindAccount},
		controlQuestion:  {Choice: noControlKey, Probabilities: map[string]float64{"control_1": 0.3}},
		guestQuestion:    {Noul: yes(0.1)},
		accountQuestion:  {Choice: AccountSignIn},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Sign in", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Guest || read.Fallback == nil || read.Fallback.ID != 11 {
		t.Fatalf("read = %+v err = %v, want no guest path and a fallback", read, err)
	}
}

// The decision reads what a control does; no instruction quotes a control's wording,
// since every site words its controls its own way.
func TestControlInstructionsQuoteNoWording(t *testing.T) {
	quoted := regexp.MustCompile(`"[^"]+"|\([A-Z][a-z]+(, [A-Z][a-z]+)+`)
	for _, intent := range []string{IntentStart, IntentAdvance} {
		if found := quoted.FindString(controlInstructions(intent)); found != "" {
			t.Errorf("%s instructions quote wording %q", intent, found)
		}
	}
}

func TestReadPageSaysWhenThePageWaitsForThePerson(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		controlQuestion:  {Choice: "control_1"},
		verifyQuestion:   {Choice: VerifyOther},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Enter the code we texted you", Intent: IntentAdvance, Controls: formControls})
	if err != nil || !read.NeedsPerson {
		t.Fatalf("read = %+v err = %v, want a page waiting on the person", read, err)
	}
}

// A choice of where to send a code, email among them, is answered by the run with
// email: it never waits on the applicant's phone.
func TestReadPageChoosingEmailIsNoWait(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindAccount},
		controlQuestion:  {Choice: "control_1"},
		verifyQuestion:   {Choice: VerifyChooseEmail},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Where should we send your code?", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.NeedsPerson || read.Verification != VerifyChooseEmail {
		t.Fatalf("read = %+v err = %v, want choose_email without waiting on the person", read, err)
	}
	criteria := decider.last.Questions[verifyQuestion].Criteria
	if !strings.Contains(criteria[VerifyChooseEmail], emailOnly) {
		t.Fatalf("choose_email criteria = %q, want the email-only rule", criteria[VerifyChooseEmail])
	}
}

// An icon control is described by what surrounds it, so the decision can tell which
// entry it opens.
func TestReadPageDescribesAnIconControlByItsSurroundings(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		controlQuestion:  {Choice: "control_0"},
	}}
	controls := []Control{{ID: 7, Tag: "button", Near: "Unnamed Major Fields to fix: 1"}}
	if _, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Education", Intent: IntentAdvance, Controls: controls}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(decider.last.State, `beside "Unnamed Major Fields to fix: 1"`) {
		t.Fatalf("state = %q, want the control's surroundings", decider.last.State)
	}
}

// What a long form says at its bottom (a code prompt beside Submit) reaches the
// decision, both clipped into the page text and as text new since the last action.
func TestReadPageKeepsTheEndOfALongPageAndItsNewText(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{pageKindQuestion: {Choice: KindForm}}}
	prompt := "A verification code was sent to your email"
	text := strings.Repeat("Question about the applicant. ", maxPageText/10) + prompt
	query := PageQuery{Text: text, Intent: IntentAdvance, Controls: formControls, NewText: []string{prompt}}
	if _, err := New(decider).ReadPage(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	state := decider.last.State
	if strings.Count(state, prompt) != 2 || !strings.Contains(state, "since the run's last action") {
		t.Fatalf("state does not carry the page's bottom twice: %q", state[len(state)-400:])
	}
}

// The decision hears what the run just did: a form that stopped offering Submit
// right after Submit was clicked reads as sent.
func TestReadPageTellsTheLastClick(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{pageKindQuestion: {Choice: KindConfirmation}}}
	query := PageQuery{Text: "Introduce Yourself", Intent: IntentAdvance, Controls: formControls,
		LastClick: "Submit", LastClickRole: RoleSubmit, LastClickAgo: 4}
	read, err := New(decider).ReadPage(context.Background(), query)
	if err != nil || read.Kind != KindConfirmation {
		t.Fatalf("read = %+v err = %v", read, err)
	}
	if !strings.Contains(decider.last.State, `clicked "Submit" (the control that sends the application) 4 seconds ago`) {
		t.Fatalf("state does not say what was clicked: %q", decider.last.State)
	}
}

// An account step that, by the same answer, shows no account form is a step of
// the application to fill; and a control Jev barely believes in is no fallback.
func TestReadPageAccountStepWithNoAccountFormIsAForm(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindAccount},
		controlQuestion:  {Choice: noControlKey, Probabilities: map[string]float64{"control_0": 0.02}},
		accountQuestion:  {Choice: AccountNone},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Data Consent", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.Kind != KindForm || read.Fallback != nil {
		t.Fatalf("read = %+v err = %v, want a form with no fallback", read, err)
	}
}

// A page Jev calls complete without believing it, while it is sure a control still
// moves the application on, is not complete: it is the likeliest kind that moves on.
func TestReadPageUnsureConfirmationWithAWayOnIsNotComplete(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindConfirmation, Confidence: 0.28, Probabilities: map[string]float64{
			KindConfirmation: 0.4, KindPosting: 0.28, KindForm: 0.25, KindAccount: 0.05, KindOther: 0.01,
		}},
		controlQuestion: {Choice: "control_1", Confidence: 0.98},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Pending", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Kind != KindPosting || read.Control == nil || read.Control.ID != 11 || read.Control.Role != RoleApply {
		t.Fatalf("read = %+v control = %+v err = %v, want a posting that applies with control 11", read, read.Control, err)
	}
}

// A confirmation Jev believes stands, whatever control it also names.
func TestReadPageSureConfirmationStands(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindConfirmation, Confidence: 0.9, Probabilities: map[string]float64{
			KindConfirmation: 0.9, KindForm: 0.1,
		}},
		controlQuestion: {Choice: "control_1", Confidence: 0.9},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Thank you", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.Kind != KindConfirmation {
		t.Fatalf("read = %+v err = %v, want a confirmation", read, err)
	}
}

// A step that asks only for the account's email stays an account step of its own.
func TestReadPageEmailFirstStepIsIdentify(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindAccount},
		controlQuestion:  {Choice: "control_1", Confidence: 0.9},
		accountQuestion:  {Choice: AccountIdentify},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Enter your information", Controls: formControls})
	if err != nil || read.Kind != KindAccount || read.AccountMode != AccountIdentify || read.Control == nil {
		t.Fatalf("read = %+v err = %v, want an identify account step", read, err)
	}
	if IsAccountGoal(AccountIdentify) || IsAccountGoal(AccountChoose) || !IsAccountGoal(AccountCreate) {
		t.Fatal("identify and choose are page forms, never goals")
	}
}

// An account step reports which account goals it makes possible: its own form, and
// each one a control on it opens. Off account steps it reports none.
func TestReadPageReportsWhatAnAccountStepOffers(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion:                     {Choice: KindAccount},
		accountQuestion:                      {Choice: AccountSignIn},
		offersQuestionPrefix + AccountSignIn: {Noul: yes(0.1)},
		offersQuestionPrefix + AccountCreate: {Noul: yes(0.2)},
		offersQuestionPrefix + AccountReset:  {Noul: yes(0.9)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Enter your password", Controls: formControls})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(read.Offers, ","); got != AccountSignIn+","+AccountReset {
		t.Fatalf("offers = %q, want the page's own sign-in form and the reset it opens", got)
	}

	decider.answers[pageKindQuestion] = jev.Answer{Choice: KindForm}
	read, err = New(decider).ReadPage(context.Background(), PageQuery{Text: "Your details", Controls: formControls})
	if err != nil || len(read.Offers) != 0 {
		t.Fatalf("offers off an account step = %v err = %v, want none", read.Offers, err)
	}
}

func TestOffersInstructionsQuoteNoWording(t *testing.T) {
	quoted := regexp.MustCompile(`"[^"]+"|\([A-Z][a-z]+(, [A-Z][a-z]+)+`)
	for _, goal := range offerOrder {
		if found := quoted.FindString(offersInstructions(goal)); found != "" {
			t.Errorf("%s offers instructions quote wording %q", goal, found)
		}
	}
}

func TestJudgeAccountOutcome(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		outcomeQuestion: {Choice: OutcomeRefused, Confidence: 0.9},
	}}
	gateway := New(decider)
	got, err := gateway.JudgeAccountOutcome(context.Background(), AccountOutcomeQuery{
		Sent: AccountSignIn, URL: "https://login.example/password", Title: "Log in",
		NewText: []string{"Wrong username or password"}, Flagged: 1,
	})
	if err != nil || got.Outcome != OutcomeRefused {
		t.Fatalf("outcome = %+v err = %v, want refused", got, err)
	}
	if !strings.Contains(decider.last.State, "Wrong username or password") {
		t.Fatalf("state does not carry what the page said:\n%s", decider.last.State)
	}

	if _, err := gateway.JudgeAccountOutcome(context.Background(), AccountOutcomeQuery{Sent: AccountIdentify}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid for a step that is not an account goal", err)
	}
	decider.answers[outcomeQuestion] = jev.Answer{Choice: "maybe"}
	if _, err := gateway.JudgeAccountOutcome(context.Background(), AccountOutcomeQuery{Sent: AccountReset}); err == nil {
		t.Fatal("an unknown outcome must be an error, not a guess")
	}
}
