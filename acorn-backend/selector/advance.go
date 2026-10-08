package selector

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

// Page kinds Jev can name. They are the Run orchestrator's branches.
const (
	KindPosting      = "job_posting"
	KindForm         = "application_form"
	KindConfirmation = "confirmation"
	KindBlocked      = "blocked"
	// KindAccount is a step that asks the applicant to sign in, create an account,
	// recover the account, or go on without one, before or during the form.
	KindAccount = "account_step"
	KindOther   = "other"
)

// Roles a picked control can have. Apply opens the application from a posting;
// next and submit move a filled form forward.
const (
	RoleApply  = "apply"
	RoleNext   = "next"
	RoleSubmit = "submit"
)

// Intents say what the caller wants from this page.
const (
	// IntentStart is the first look at a page: a posting to apply from, or a form already open.
	IntentStart = "start"
	// IntentAdvance is a form that has just been filled: which control moves it forward.
	IntentAdvance = "advance"
)

// Verifications a page can ask for. The email ones are read from the applicant's
// connected mailbox; any other waits for the applicant.
const (
	VerifyNone      = "none"
	VerifyEmailCode = "email_code"
	VerifyEmailLink = "email_link"
	VerifyOther     = "other"
)

var verifications = map[string]string{
	VerifyNone: "The page asks for no verification. A sign-in, sign-up, or password form is not a verification " +
		"(the run fills those from the applicant's profile), and neither is a field the page tells people to leave empty.",
	VerifyEmailCode: "The site has sent the applicant an email with a code, and the page asks for that code.",
	VerifyEmailLink: "The site says it has sent the applicant an email with a link to open before going on (to verify the address, " +
		"activate the account, or reset the password): check your email, or an account step answered with that. A form that " +
		"only says an email will be sent once it is submitted has not sent one yet.",
	VerifyOther: "The page waits for something only the applicant can give in the moment: a code sent to their phone, " +
		"an authenticator app code, or a challenge they must solve themselves.",
}

// Account modes say what an account step asks for. The run fills the applicant's
// email and the profile's default account password on any of them.
const (
	AccountNone   = "none"
	AccountSignIn = "sign_in"
	AccountCreate = "create_account"
	AccountReset  = "reset_password"
	AccountChoose = "choose"
)

// accountGoals say, for the decision, what each account goal asks the page to do.
var accountGoals = map[string]string{
	AccountSignIn: "sign in to the applicant's existing account",
	AccountCreate: "create a new account for the applicant",
	AccountReset:  "recover the account by resetting its password (request the reset, or save the new password)",
}

var accountModes = map[string]string{
	AccountNone:   "Not an account step.",
	AccountSignIn: "A sign-in form for an existing account, with the email or username and password fields on the page.",
	AccountCreate: "A form that creates a new account, with the email and new password fields on the page (the password often repeated).",
	AccountReset:  "A step that recovers the account: a form that asks for the email to send a password reset to, or a form that sets a new password.",
	AccountChoose: "A choice of how to go on (signing in, creating an account, a way to sign in, or going on without one), " +
		"with no email and password fields on the page yet.",
}

// AccountAttempt is one account step the run already sent on this site, and how
// the site answered it.
type AccountAttempt struct {
	Mode     string
	Accepted bool
	// Messages are the page's own words after a rejected attempt.
	Messages []string
}

// IsAccountMode says whether mode is one ReadPage can return.
func IsAccountMode(mode string) bool {
	_, listed := accountModes[mode]
	return listed
}

const (
	pageKindQuestion = "page_kind"
	controlQuestion  = "control"
	finalQuestion    = "is_final_step"
	guestQuestion    = "continues_without_account"
	diagnoseQuestion = "failure"
	verifyQuestion   = "verification"
	appliedQuestion  = "already_applied"
	accountQuestion  = "account_mode"

	controlKeyPrefix = "control"
	noControlKey     = "none"

	// maxPageText bounds the page copy Jev reads; the controls matter more than the prose.
	maxPageText = 6000
	// maxControlLine bounds one control's description.
	maxControlLine = 220
	// maxEvidence bounds the lines of page evidence sent with a diagnosis.
	maxEvidence = 24
)

// Control is one clickable thing on the page, read from the pure tree.
type Control struct {
	// ID is the tree node id the extension clicks.
	ID int
	// Tag is the element: button, a, input, or a role=button element.
	Tag  string
	Text string
	// Label is aria-label, title, or value when the control has no text of its own.
	Label string
	Type  string
	Href  string
	// Context is the nearest heading, legend, or form name around the control.
	Context  string
	Disabled bool
	// InForm is true when the control sits inside a <form>.
	InForm bool
	// Dialog is the name of the open dialog the control sits in; "" outside every dialog.
	Dialog string
	// Covered is true when an open dialog is over the control, so a person could not click it.
	Covered bool
}

// PageQuery is what Jev reads to say what a page is and what to click on it.
type PageQuery struct {
	URL      string
	Title    string
	Text     string
	Intent   string
	Controls []Control
	// Flagged is how many fields the page marks invalid right now.
	Flagged int
	// PageMessages are page-level alerts, such as "Please fix the errors below".
	PageMessages []string
	// Account is what the run already tried on this site's account steps, oldest first.
	Account []AccountAttempt
	// AccountGoal is the account step the run works toward on this page (an Account*
	// key); the run decides it, Jev only finds the control that does it.
	AccountGoal string
}

// ControlPick is the control to click and what it does.
type ControlPick struct {
	ID         int
	Role       string
	Confidence float64
	// Probabilities maps control ids to Jev's probability, for the log.
	Probabilities map[int]float64
}

// PageRead is Jev's reading of one page.
type PageRead struct {
	Kind           string
	KindConfidence float64
	KindProbs      map[string]float64
	// Control is nil when no control moves the application forward.
	Control *ControlPick
	// Fallback is Jev's most probable forward control when it answered none on a
	// form it was asked to advance: the run clicks it before deciding the page is
	// stuck, since a page that looks blocked often reacts to the click itself (it
	// shows which fields it still needs).
	Fallback *ControlPick
	// Guest is true when the page offers a way to go on without signing in or
	// creating an account; on an account step the run clicks only then.
	Guest bool
	// NeedsPerson is true when the page waits on something only the applicant can
	// give in the moment (a phone code, a challenge to solve): the run waits. It is
	// the VerifyOther answer, so the two can never disagree.
	NeedsPerson bool
	// Verification is what the page asks to verify (a Verify* key); VerifyNone when nothing.
	Verification string
	// AccountMode is what an account step asks for (an Account* key); AccountNone elsewhere.
	AccountMode string
	// AlreadyApplied is true when the site says this applicant already applied to this job.
	AlreadyApplied bool
	Usage          jev.Usage
}

var pageKinds = []struct{ key, description string }{
	{KindPosting, "A job posting or job description page for one role (duties, requirements, qualifications) that has not opened an application form yet. It may have a control that opens the application."},
	{KindForm, "An application form or one step of a multi-step application: the page asks the applicant for their details, questions, résumé, or a final review before submitting."},
	{KindAccount, "A step of the application that asks the applicant to sign in, create an account, recover or reset the account's password, or continue without an account, rather than asking for their application details."},
	{KindConfirmation, "The application is complete: the page thanks the applicant or says the application was received or submitted."},
	{KindBlocked, "The page cannot be worked yet: a CAPTCHA or bot check, an error page, or a page that says the job is closed. A sign-in or sign-up page is an account step, not blocked."},
	{KindOther, "Not part of applying for a job: a search results list, a company page, or any unrelated site."},
}

func pageKindCriteria() map[string]string {
	criteria := make(map[string]string, len(pageKinds))
	for _, kind := range pageKinds {
		criteria[kind.key] = kind.description
	}
	return criteria
}

// ReadPage says what kind of page this is and which control to click next. One
// Jev call answers all of it, so a step costs one decision.
func (g *Gateway) ReadPage(ctx context.Context, q PageQuery) (PageRead, error) {
	if strings.TrimSpace(q.Text) == "" && len(q.Controls) == 0 {
		return PageRead{}, fmt.Errorf("%w: page text or controls are required", ErrInvalid)
	}
	controls := q.Controls
	if limit := jev.MaxChoiceOptions - 1; len(controls) > limit {
		controls = controls[:limit]
	}

	controlCriteria := map[string]string{
		noControlKey: "No listed control moves the application forward from this page.",
	}
	keys := make(map[string]int, len(controls))
	for i, control := range controls {
		key := fmt.Sprintf("%s_%d", controlKeyPrefix, i)
		keys[key] = control.ID
		controlCriteria[key] = describeControl(control)
	}

	res, err := g.decider.Decide(openai.WithCall(ctx, "read-page"), jev.Request{
		State: pageState(q, controls),
		Questions: map[string]jev.Question{
			pageKindQuestion: {
				Type:         jev.TypeChoice,
				Instructions: "What kind of page is this in a job application?",
				Criteria:     pageKindCriteria(),
			},
			controlQuestion: {
				Type:         jev.TypeChoice,
				Instructions: controlInstructions(q.Intent),
				Criteria:     controlCriteria,
			},
			finalQuestion: {
				Type: jev.TypeNoul,
				Instructions: "Is this the last step of the application, so that the control which moves forward sends the " +
					"application rather than opening another page or step?",
				Criteria: map[string]string{
					"true":  "The last step: the forward control submits the application.",
					"false": "Not the last step: the forward control opens another page or step.",
				},
			},
			guestQuestion: {
				Type:         jev.TypeNoul,
				Instructions: "Does this page offer a way to go on with the application without signing in or creating an account?",
				Criteria: map[string]string{
					"true": "A control continues the application itself without any account (apply as a guest). A control that " +
						"sends or switches between account forms (sign in, create an account, reset a password) is not one.",
					"false": "Going on requires signing in or creating an account, or the page asks neither.",
				},
			},
			appliedQuestion: {
				Type: jev.TypeNoul,
				Instructions: "Does this page say the applicant has already applied to this job: an application to this role " +
					"that was already submitted before, as opposed to one being filled in now or just completed?",
				Criteria: map[string]string{
					"true":  "The site says an application to this job was already submitted earlier.",
					"false": "Nothing on the page says this job was applied to before.",
				},
			},
			verifyQuestion: {
				Type:         jev.TypeChoice,
				Instructions: "Does this page ask the applicant to verify something before it can go on, and how?",
				Criteria:     verifications,
			},
			accountQuestion: {
				Type:         jev.TypeChoice,
				Instructions: "When this page is an account step, what does it ask for?",
				Criteria:     accountModes,
			},
		},
	})
	if err != nil {
		return PageRead{}, err
	}

	kind, ok := res.Answers[pageKindQuestion]
	if !ok {
		return PageRead{}, errors.New("jev returned no page kind")
	}
	read := PageRead{
		Kind:           kind.Choice,
		KindConfidence: kind.Confidence,
		KindProbs:      kind.Probabilities,
		Usage:          res.Usage,
	}
	if _, listed := pageKindCriteria()[read.Kind]; !listed {
		read.Kind = KindOther
	}

	if guest := res.Answers[guestQuestion]; guest.Noul != nil {
		read.Guest = *guest.Noul > checkThreshold
	}
	if applied := res.Answers[appliedQuestion]; applied.Noul != nil {
		read.AlreadyApplied = *applied.Noul > checkThreshold
	}
	read.Verification = listedChoice(res.Answers[verifyQuestion], verifications, VerifyNone)
	read.NeedsPerson = read.Verification == VerifyOther
	read.AccountMode = AccountNone
	if read.Kind == KindAccount {
		read.AccountMode = listedChoice(res.Answers[accountQuestion], accountModes, AccountNone)
	}
	answer, ok := res.Answers[controlQuestion]
	if !ok {
		return read, nil
	}
	probabilities := map[int]float64{}
	for key, p := range answer.Probabilities {
		if controlID, ok := keys[key]; ok {
			probabilities[controlID] = p
		}
	}
	role := controlRole(read.Kind, res.Answers[finalQuestion])
	if id, listed := keys[answer.Choice]; listed {
		read.Control = &ControlPick{ID: id, Role: role, Confidence: answer.Confidence, Probabilities: probabilities}
		return read, nil
	}
	if (q.Intent == IntentAdvance && read.Kind == KindForm) || read.Kind == KindAccount {
		controlKeys := make(map[string]string, len(keys))
		for key := range keys {
			controlKeys[key] = key
		}
		if key := bestKey(answer.Probabilities, controlKeys); key != "" {
			read.Fallback = &ControlPick{ID: keys[key], Role: role, Confidence: answer.Probabilities[key], Probabilities: probabilities}
		}
	}
	return read, nil
}

// listedChoice is a choice answer when it names a listed key, otherwise fallback.
func listedChoice(answer jev.Answer, listed map[string]string, fallback string) string {
	if _, ok := listed[answer.Choice]; ok {
		return answer.Choice
	}
	return fallback
}

// controlRole names what the picked control does from the page kind and Jev's
// "last step" answer.
func controlRole(kind string, final jev.Answer) string {
	if kind == KindPosting {
		return RoleApply
	}
	// An account step never sends the application; its control only moves on.
	if kind == KindAccount {
		return RoleNext
	}
	if final.Noul != nil && *final.Noul > checkThreshold {
		return RoleSubmit
	}
	return RoleNext
}

// accountSteps steer every pick on a step that asks for an account: going on
// without one comes first; otherwise the run signs in or creates the account with
// the details on the page, and the account history says which to try next.
const accountSteps = "When the page offers a way to go on with the application without signing in or creating an account, " +
	"pick that control over signing in or creating an account. Otherwise, on a step that needs an account, do the account goal " +
	"given in the page state: when the page shows the goal's own form, pick the control that sends it; when it shows another " +
	"form or only choices, pick the control that opens the goal's form, or the one that leads toward it (the way to use an " +
	"email and password, where the other account forms are offered). Never pick one that signs in through another service. "

// dialogSteps steer every pick when a dialog is open over the page: the dialog is
// the step, and what it covers cannot be clicked. A dialog that asks how to start
// is answered by starting on this site, never through another service.
const dialogSteps = "When a dialog is open over the page, that dialog is the current step: pick only among the controls " +
	"inside it, never a control marked covered (it sits behind the dialog, and clicking it does nothing). " +
	"When the dialog asks how to start the application, pick the way that starts it on this site with the applicant " +
	"entering their details: applying manually first, else starting from an uploaded résumé. Never pick one that " +
	"reuses a previous application or applies through another service's account. "

// controlInstructions describe controls only by what they do: sites word them
// any way they like, so no wording is quoted here.
func controlInstructions(intent string) string {
	if intent == IntentAdvance {
		return "The applicant has finished filling this page. Which control moves the application to its next step, " +
			"or sends it on the last step? Judge by what the control does on this page, whatever its wording, " +
			"an arrow, or an icon. " + dialogSteps + accountSteps +
			"Never pick a control that goes back, cancels, leaves the application, saves a draft, signs out, " +
			"signs in through another service, or opens another site. " +
			"Prefer an enabled control, but a forward control that looks disabled is still the forward control: " +
			"many forms only grey it out until their fields are valid, and clicking it shows what they still need. " +
			"Choose none only when nothing here moves the application forward."
	}
	return "Which control starts or continues an application for this role? On a job posting it is the control " +
		"that opens the application. When the page is already an application form or an account step, pick the " +
		"control that moves it forward instead. " + dialogSteps + accountSteps +
		"Never pick a control that saves the job, shares it, creates an alert, signs in through another service, " +
		"or is disabled. Choose none when the page has no way to apply or continue."
}

func pageState(q PageQuery, controls []Control) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Page URL: %s\nPage title: %s\n", firstNonEmpty(q.URL, "(unknown)"), firstNonEmpty(q.Title, "(untitled)"))
	if q.Flagged > 0 {
		fmt.Fprintf(&b, "Fields the page currently flags as invalid: %d\n", q.Flagged)
	}
	for _, message := range q.PageMessages {
		fmt.Fprintf(&b, "Page message: %s\n", clip(message, maxControlLine))
	}
	if dialog := openDialog(controls); dialog != "" {
		fmt.Fprintf(&b, "An open dialog is over the page: %q. The page text below includes what it covers.\n", clip(dialog, maxControlLine))
	}
	if goal, ok := accountGoals[q.AccountGoal]; ok {
		fmt.Fprintf(&b, "Account goal on this page: %s (%s).\n", q.AccountGoal, goal)
	}
	writeAccountHistory(&b, q.Account)
	b.WriteString("\nPage text:\n")
	b.WriteString(clip(q.Text, maxPageText))
	b.WriteString("\n\nControls on the page:\n")
	if len(controls) == 0 {
		b.WriteString("(none)\n")
	}
	for i, control := range controls {
		fmt.Fprintf(&b, "%s_%d: %s\n", controlKeyPrefix, i, describeControl(control))
	}
	return b.String()
}

// openDialog is the name of the dialog the page's controls sit in, when one is open.
func openDialog(controls []Control) string {
	for _, control := range controls {
		if control.Dialog != "" {
			return control.Dialog
		}
	}
	return ""
}

// writeAccountHistory lists the account steps the run already sent on this site.
func writeAccountHistory(b *strings.Builder, attempts []AccountAttempt) {
	if len(attempts) == 0 {
		return
	}
	b.WriteString("Account history on this site (oldest first):\n")
	for _, attempt := range attempts {
		outcome := "accepted: the site went on"
		if !attempt.Accepted {
			outcome = "rejected: the site stayed on the same step"
		}
		fmt.Fprintf(b, "- %s, %s", attempt.Mode, outcome)
		for _, message := range attempt.Messages {
			fmt.Fprintf(b, "; page said %q", clip(message, maxControlLine))
		}
		b.WriteString("\n")
	}
}

func describeControl(c Control) string {
	parts := []string{c.Tag}
	if c.Type != "" {
		parts = append(parts, "type="+c.Type)
	}
	text := firstNonEmpty(c.Text, c.Label)
	if text == "" {
		text = "(no text)"
	}
	line := strings.Join(parts, " ") + " \"" + clip(text, maxControlLine/2) + "\""
	if c.Label != "" && c.Label != text {
		line += " label=\"" + clip(c.Label, 60) + "\""
	}
	if c.Href != "" {
		line += " href=" + clip(c.Href, 80)
	}
	if c.Context != "" {
		line += " under \"" + clip(c.Context, 60) + "\""
	}
	if c.Dialog != "" {
		line += " in dialog \"" + clip(c.Dialog, 60) + "\""
	}
	if c.InForm {
		line += " in-form"
	}
	if c.Covered {
		line += " COVERED by an open dialog"
	}
	if c.Disabled {
		line += " DISABLED"
	}
	return clip(line, maxControlLine*2)
}

// Failure reasons Jev can name when a Run cannot finish.
const (
	FailMissingRequired = "missing_required"
	FailRejectedAnswer  = "rejected_answer"
	FailUpload          = "upload_failed"
	FailBotCheck        = "bot_check"
	FailLogin           = "login_required"
	FailNoControl       = "no_forward_control"
	FailNoEffect        = "click_had_no_effect"
	FailSiteError       = "site_error"
	FailClosed          = "job_closed"
	FailNotApplication  = "not_an_application"
	FailOther           = "other"
)

var failureReasons = []struct{ key, description string }{
	{FailMissingRequired, "Required fields are still empty: the profile has no answer for them, or Acorn could not fill them."},
	{FailRejectedAnswer, "The page rejects values that were entered, such as a wrong format, a limit, or an answer the form refuses."},
	{FailUpload, "A résumé or document upload did not attach or the page refuses the file."},
	{FailBotCheck, "A CAPTCHA, \"verify you are human\" check, or email or phone verification code blocks the application — including a verification widget embedded from another site (an embedded frame) that is unsolved, failed, or expired, so the page holds Submit."},
	{FailLogin, "The site needs the applicant to sign in or create an account first."},
	{FailNoControl, "The page never offered a control that moves the application forward. Not when a control was clicked and the page then held it (busy or gone) because something else blocks it."},
	{FailNoEffect, "The forward control was clicked but the page did not change and flags nothing."},
	{FailSiteError, "The site shows an error, times out, or crashes."},
	{FailClosed, "The job is closed, expired, or no longer accepts applications."},
	{FailNotApplication, "This page is not a job posting or application."},
	{FailOther, "None of the above."},
}

// FailureLabels is the sentence the extension shows for each reason.
var FailureLabels = map[string]string{
	FailMissingRequired: "Required fields were left empty",
	FailRejectedAnswer:  "The page rejected the answers Acorn entered",
	FailUpload:          "A file upload did not work",
	FailBotCheck:        "A bot check or verification code is blocking the form",
	FailLogin:           "The site needs a sign-in first",
	FailNoControl:       "Acorn could not find a Next or Submit control",
	FailNoEffect:        "Clicking Next or Submit changed nothing on the page",
	FailSiteError:       "The site showed an error",
	FailClosed:          "The job is closed",
	FailNotApplication:  "This page is not a job application",
	FailOther:           "The run could not finish",
}

// FailureQuery is what went wrong, as evidence lines the extension gathered.
type FailureQuery struct {
	URL   string
	Title string
	// Stage is where the run stopped: apply, fill, advance, or refill.
	Stage string
	// Attempts is how many Refill rounds were spent.
	Attempts int
	// Evidence is flagged-field messages, page alerts, and failed steps, one per line.
	Evidence []string
	// Text is the visible page copy.
	Text string
}

// Failure is Jev's reason a run could not finish.
type Failure struct {
	Reason        string
	Confidence    float64
	Probabilities map[string]float64
	Usage         jev.Usage
}

// Diagnose picks the reason a run stopped. Jev chooses among fixed reasons; the
// caller pairs the reason with the page's own words.
func (g *Gateway) Diagnose(ctx context.Context, q FailureQuery) (Failure, error) {
	if len(q.Evidence) == 0 && strings.TrimSpace(q.Text) == "" {
		return Failure{}, fmt.Errorf("%w: evidence or page text is required", ErrInvalid)
	}
	criteria := make(map[string]string, len(failureReasons))
	for _, reason := range failureReasons {
		criteria[reason.key] = reason.description
	}
	evidence := q.Evidence
	if len(evidence) > maxEvidence {
		evidence = evidence[:maxEvidence]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Page URL: %s\nPage title: %s\nStopped at stage: %s\nRefill attempts spent: %d\n\nEvidence:\n",
		firstNonEmpty(q.URL, "(unknown)"), firstNonEmpty(q.Title, "(untitled)"), firstNonEmpty(q.Stage, "(unknown)"), q.Attempts)
	for _, line := range evidence {
		b.WriteString("- " + clip(line, maxControlLine) + "\n")
	}
	b.WriteString("\nPage text:\n" + clip(q.Text, maxPageText))

	res, err := g.decider.Decide(openai.WithCall(ctx, "diagnose"), jev.Request{
		State: b.String(),
		Questions: map[string]jev.Question{diagnoseQuestion: {
			Type:         jev.TypeChoice,
			Instructions: "An automatic job application run stopped before it finished. What is the main reason it could not continue?",
			Criteria:     criteria,
		}},
	})
	if err != nil {
		return Failure{}, err
	}
	answer, ok := res.Answers[diagnoseQuestion]
	if !ok {
		return Failure{}, errors.New("jev returned no failure reason")
	}
	reason := answer.Choice
	if _, listed := criteria[reason]; !listed {
		reason = FailOther
	}
	return Failure{Reason: reason, Confidence: answer.Confidence, Probabilities: answer.Probabilities, Usage: res.Usage}, nil
}

// TopProbabilities lists the n most probable keys, for logs.
func TopProbabilities(probs map[string]float64, n int) []string {
	type row struct {
		key string
		p   float64
	}
	rows := make([]row, 0, len(probs))
	for key, p := range probs {
		rows = append(rows, row{key, p})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].p != rows[j].p {
			return rows[i].p > rows[j].p
		}
		return rows[i].key < rows[j].key
	})
	if len(rows) > n {
		rows = rows[:n]
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = fmt.Sprintf("%s=%.2f", r.key, r.p)
	}
	return out
}
