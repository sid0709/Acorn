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
	// RoleResolve starts or completes something the page still requires before it
	// can be sent (an assessment, a document, a section the page names as an issue).
	RoleResolve = "resolve"
	// RoleCommit saves what a requirement's click opened inside the page and the run
	// filled (an entry form, a dialog), so the page keeps it.
	RoleCommit = "commit"
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
	// VerifyChooseEmail is a choice of where the site sends a code, email among them:
	// the run answers it with email and sends it, so the code lands in the Gmail it reads.
	VerifyChooseEmail = "choose_email"
	VerifyOther       = "other"
)

// emailOnly is the rule every verification answer follows: the run reads the
// applicant's Gmail and can never read their phone.
const emailOnly = "The run can read only the applicant's email, never their phone, so a code must always go to email: " +
	"never by text message, SMS, phone call, WhatsApp, or an authenticator app. "

var verifications = map[string]string{
	VerifyNone: "The page asks for no verification. A sign-in, sign-up, or password form is not a verification " +
		"(the run fills those from the applicant's profile), and neither is a field the page tells people to leave empty.",
	VerifyEmailCode: "The site has sent the applicant an email with a code, and the page asks for that code.",
	VerifyEmailLink: "The site says it has sent the applicant an email with a link to open before going on (to verify the address, " +
		"activate the account, or reset the password): check your email, or an account step answered with that. A form that " +
		"only says an email will be sent once it is submitted has not sent one yet.",
	VerifyChooseEmail: "The page asks where or how to send a verification code (a choice of the applicant's email address, " +
		"phone number, text message, or call) and email is one of the choices. No code has been sent yet. " + emailOnly +
		"The run chooses the email and sends it, so this is never a wait for the applicant.",
	VerifyOther: "The page is stopped on a prompt that asks right now for something only the applicant can give in the moment: " +
		"a box for a code already sent to their phone with no way to send it to email instead, an authenticator app code, or a " +
		"challenge they must solve themselves. A choice of where to send a code that offers email is choose_email, not this. " +
		"A form that asks for the applicant's details (a phone number or address to fill in) is not this, and neither is a note " +
		"about how to sign in or change contact details later.",
}

// Account modes say what an account step asks for. The run fills the applicant's
// email and the profile's default account password on any of them.
const (
	AccountNone   = "none"
	AccountSignIn = "sign_in"
	AccountCreate = "create_account"
	AccountReset  = "reset_password"
	AccountChoose = "choose"
	// AccountIdentify is the first step of signing in and of creating an account alike:
	// it asks only for the account's email, and the site picks the next form from it.
	AccountIdentify = "identify"
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
	AccountIdentify: "The first step of signing in or creating an account: the page asks only for the account's email or " +
		"username, with no password field yet, and the site decides from it which form comes next.",
}

// AccountAttempt is one account step the run already sent on this site, and how
// the site answered it.
type AccountAttempt struct {
	Mode     string
	Accepted bool
	// Messages are the page's own words after a rejected attempt.
	Messages []string
}

// accountOffers say, for each account goal, what a page that offers it shows.
// Asked on every account step, apart from the goal, so the run knows which steps
// the site makes possible before it chooses one.
var accountOffers = map[string]string{
	AccountSignIn: "signing in to an existing account on this site with an email or username and a password",
	AccountCreate: "creating a new account on this site with an email and a new password",
	AccountReset:  "recovering the account's password on this site (asking for a reset, or setting a new password)",
}

// offerOrder lists the account goals in the order offers are reported.
var offerOrder = []string{AccountSignIn, AccountCreate, AccountReset}

// offersInstructions asks whether a page offers one account goal, whatever goal the run has.
func offersInstructions(goal string) string {
	return "Does this page offer " + accountOffers[goal] + ", whatever account goal the page state gives? It does when " +
		"the page shows that form, or a control on the page opens it. Doing it through another service's account " +
		"(signing in with another company's login) does not count, and neither does recovering only a username."
}

// IsAccountGoal says whether mode is an account step the run can set out to do.
func IsAccountGoal(mode string) bool {
	_, listed := accountGoals[mode]
	return listed
}

// IsAccountMode says whether mode is one ReadPage can return.
func IsAccountMode(mode string) bool {
	_, listed := accountModes[mode]
	return listed
}

const (
	pageKindQuestion     = "page_kind"
	controlQuestion      = "control"
	finalQuestion        = "is_final_step"
	guestQuestion        = "continues_without_account"
	guestControlQuestion = "guest_control"
	requirementQuestion  = "outstanding_requirement"
	commitQuestion       = "save_opened_form"
	diagnoseQuestion     = "failure"
	verifyQuestion       = "verification"
	appliedQuestion      = "already_applied"
	accountQuestion      = "account_mode"
	offersQuestionPrefix = "offers_"

	controlKeyPrefix = "control"
	noControlKey     = "none"

	// maxPageText bounds the page copy Jev reads; the controls matter more than the prose.
	maxPageText = 6000
	// maxControlLine bounds one control's description.
	maxControlLine = 220
	// maxControlNear bounds the surroundings quoted for a control with little text of its own.
	maxControlNear = 100
	// maxEvidence bounds the lines of page evidence sent with a diagnosis.
	maxEvidence = 24
	// minFallbackConfidence is the least probability a control needs to be clicked
	// as the forward control when Jev answered none.
	minFallbackConfidence = 0.2
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
	// Near is the text around a control that has little of its own (an icon button):
	// the entry or section it acts on.
	Near string
	// Opened is true for a control of the form the run opened inside the page (see
	// PageQuery.Scope); ReadPage sets it from the query.
	Opened bool
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
	// NewText is the lines the page shows now that it did not at the run's last look
	// at it: its answer to the run's last action, wherever on the page it appeared.
	NewText []string
	// LastClick is the control the run clicked last on this site and what it does
	// (an Role* key), with how long ago; empty before any click.
	LastClick     string
	LastClickRole string
	LastClickAgo  int
	// Scope lists the controls of what a requirement's click opened inside the page
	// (an entry form, a dialog) once the run filled it: ReadPage then names the one
	// that saves it. ScopeTitle is what the page calls it.
	Scope      []int
	ScopeTitle string
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
	// form it was asked to advance, an account step, or a posting: the run clicks it
	// before deciding the page is stuck, since a page that looks blocked often reacts
	// to the click itself (it shows which fields it still needs, or opens the form).
	Fallback *ControlPick
	// Guest is true when the page offers a way to go on without signing in or
	// creating an account; on an account step the run clicks only then.
	Guest bool
	// GuestControl is the control that goes on without an account, asked apart from
	// Control so the account goal never pulls the guest click onto an account form.
	// Nil unless the page is an account step, Guest is true, and Jev names one.
	GuestControl *ControlPick
	// NeedsPerson is true when the page waits on something only the applicant can
	// give in the moment (a phone code, a challenge to solve): the run waits. It is
	// the VerifyOther answer, so the two can never disagree.
	NeedsPerson bool
	// Verification is what the page asks to verify (a Verify* key); VerifyNone when nothing.
	Verification string
	// AccountMode is what an account step asks for (an Account* key); AccountNone elsewhere.
	AccountMode string
	// Offers are the account goals an account step makes possible: its own form, or
	// a control on it that opens one. Empty off account steps.
	Offers []string
	// AlreadyApplied is true when the site says this applicant already applied to this job.
	AlreadyApplied bool
	// Requirement is the control that does what the page still reports as required
	// before it can go on (role RoleResolve): the best next step ahead of Control.
	// Nil when nothing outstanding is done through a control, or on a first look.
	Requirement *ControlPick
	// Commit is the control of the opened form (PageQuery.Scope) that saves it, role
	// RoleCommit. Nil when no scope was given or none of its controls saves it.
	Commit *ControlPick
	Usage  jev.Usage
}

var pageKinds = []struct{ key, description string }{
	{KindPosting, "A job posting or job description page for one role (duties, requirements, qualifications) that has not opened an application form yet. It may have a control that opens the application."},
	{KindForm, "An application form or one step of a multi-step application: the page asks the applicant for their details, questions, résumé, or a final review before submitting."},
	{KindAccount, "A step of the application that asks the applicant to sign in, create an account, recover or reset the account's password, or continue without an account, rather than asking for their application details."},
	{KindConfirmation, "The application is complete: the page thanks the applicant or says the application was received or " +
		"submitted. Also complete: right after the run clicked the control that sends the application, the page no longer offers " +
		"a way to send it and shows no error (the form was taken even without a thank-you); or the site's candidate home or " +
		"dashboard lists this application as submitted, received, or in progress."},
	{KindBlocked, "The page cannot be worked yet: a CAPTCHA or bot check, an error page, or a page that says the job is closed. A sign-in or sign-up page is an account step, not blocked."},
	{KindOther, "Not part of applying for this job: a search results list, a company page, any unrelated site, or a general " +
		"talent-community or expression-of-interest form (leave your details or résumé to be contacted about future openings) " +
		"that does not apply to this role."},
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
	opened := make(map[int]bool, len(q.Scope))
	for _, id := range q.Scope {
		opened[id] = true
	}
	controls := make([]Control, len(q.Controls))
	for i, control := range q.Controls {
		control.Opened = opened[control.ID]
		controls[i] = control
	}
	if limit := jev.MaxChoiceOptions - 1; len(controls) > limit {
		controls = controls[:limit]
	}

	controlCriteria := map[string]string{
		noControlKey: "No listed control moves the application forward from this page.",
	}
	guestCriteria := map[string]string{
		noControlKey: "No listed control goes on with the application without an account.",
	}
	keys := make(map[string]int, len(controls))
	for i, control := range controls {
		key := fmt.Sprintf("%s_%d", controlKeyPrefix, i)
		keys[key] = control.ID
		controlCriteria[key] = describeControl(control)
		guestCriteria[key] = controlCriteria[key]
	}

	questions := map[string]jev.Question{
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
				"true":  "A control continues the application itself without any account (apply as a guest). " + guestOnly,
				"false": "Going on requires signing in or creating an account, or the page asks neither.",
			},
		},
		guestControlQuestion: {
			Type: jev.TypeChoice,
			Instructions: "Which control goes on with the application for this role without signing in or creating an " +
				"account (applying as a guest)? Judge by what the control does, whatever its wording. " + guestOnly +
				dialogSteps + "Choose none when no control does.",
			Criteria: guestCriteria,
		},
		appliedQuestion: {
			Type: jev.TypeNoul,
			Instructions: "Does this page say the applicant has already applied to this job: an application to this role " +
				"that was already submitted before, as opposed to one being filled in now or just completed? A candidate home or " +
				"dashboard that lists this job as submitted or in progress, seen before the run sent anything, says so.",
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
		offersQuestionPrefix + AccountSignIn: offersQuestion(AccountSignIn),
		offersQuestionPrefix + AccountCreate: offersQuestion(AccountCreate),
		offersQuestionPrefix + AccountReset:  offersQuestion(AccountReset),
	}
	if q.Intent == IntentAdvance {
		requirementCriteria := map[string]string{noControlKey: noRequirement}
		for key, description := range guestCriteria {
			if key != noControlKey {
				requirementCriteria[key] = description
			}
		}
		questions[requirementQuestion] = jev.Question{
			Type:         jev.TypeChoice,
			Instructions: requirementInstructions,
			Criteria:     requirementCriteria,
		}
	}
	// What the run opened and filled is saved by one of its own controls, never another.
	commitCriteria := map[string]string{noControlKey: noCommit}
	for key, id := range keys {
		if opened[id] {
			commitCriteria[key] = controlCriteria[key]
		}
	}
	if len(commitCriteria) > 1 {
		questions[commitQuestion] = jev.Question{
			Type:         jev.TypeChoice,
			Instructions: commitInstructions,
			Criteria:     commitCriteria,
		}
	}
	res, err := g.decider.Decide(openai.WithCall(ctx, "read-page"), jev.Request{
		State:     pageState(q, controls),
		Questions: questions,
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
	if unfinished := unfinishedKind(kind, res.Answers[controlQuestion], keys); unfinished != "" {
		read.Kind = unfinished
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
		// The same answer says the page shows no account form at all: then it is a
		// step of the application to fill (a consent, a location), not an account step.
		if read.AccountMode == AccountNone {
			read.Kind = KindForm
		}
	}
	if read.Kind == KindAccount {
		read.Offers = offeredGoals(read.AccountMode, res.Answers)
	}
	answer, ok := res.Answers[controlQuestion]
	if requirement, asked := res.Answers[requirementQuestion]; asked && requirement.Confidence >= minRequirementConfidence {
		// The same control as the forward pick is no separate step.
		if id, listed := keys[requirement.Choice]; listed && (!ok || requirement.Choice != answer.Choice) {
			read.Requirement = &ControlPick{ID: id, Role: RoleResolve, Confidence: requirement.Confidence}
		}
	}
	if commit, asked := res.Answers[commitQuestion]; asked && commit.Confidence >= minCommitConfidence {
		if id, listed := keys[commit.Choice]; listed && opened[id] {
			read.Commit = &ControlPick{ID: id, Role: RoleCommit, Confidence: commit.Confidence}
		}
	}
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
	if guest, ok := res.Answers[guestControlQuestion]; ok && read.Guest && read.Kind == KindAccount {
		if id, listed := keys[guest.Choice]; listed {
			read.GuestControl = &ControlPick{ID: id, Role: role, Confidence: guest.Confidence}
		}
	}
	if id, listed := keys[answer.Choice]; listed {
		read.Control = &ControlPick{ID: id, Role: role, Confidence: answer.Confidence, Probabilities: probabilities}
		return read, nil
	}
	if (q.Intent == IntentAdvance && read.Kind == KindForm) || read.Kind == KindAccount || read.Kind == KindPosting {
		controlKeys := make(map[string]string, len(keys))
		for key := range keys {
			controlKeys[key] = key
		}
		// A control Jev barely believes in (a "Back" at a few percent) is no fallback:
		// clicking it would undo the step instead of showing what the page needs.
		if key := bestKey(answer.Probabilities, controlKeys); key != "" && answer.Probabilities[key] >= minFallbackConfidence {
			read.Fallback = &ControlPick{ID: keys[key], Role: role, Confidence: answer.Probabilities[key], Probabilities: probabilities}
		}
	}
	return read, nil
}

// openKinds are the kinds of a page that still moves the application forward.
var openKinds = map[string]string{KindPosting: KindPosting, KindForm: KindForm, KindAccount: KindAccount}

// unfinishedKind is the kind of a page Jev named complete without believing it
// (less than an even chance) while it is sure a listed control still moves the
// application forward: a page that still offers a way on has not taken the
// application. It is the likeliest kind that moves forward; empty when the
// confirmation stands.
func unfinishedKind(kind, control jev.Answer, keys map[string]int) string {
	if kind.Choice != KindConfirmation || kind.Probabilities[KindConfirmation] >= checkThreshold {
		return ""
	}
	if _, listed := keys[control.Choice]; !listed || control.Confidence < checkThreshold {
		return ""
	}
	return bestKey(kind.Probabilities, openKinds)
}

// offersQuestion asks whether the page offers one account goal.
func offersQuestion(goal string) jev.Question {
	return jev.Question{
		Type:         jev.TypeNoul,
		Instructions: offersInstructions(goal),
		Criteria: map[string]string{
			"true":  "The page offers " + accountOffers[goal] + ".",
			"false": "Nothing on the page does that or opens it.",
		},
	}
}

// offeredGoals are the goals a page offers: its own form, and each one Jev says a
// control on the page opens. In the order the goals are listed.
func offeredGoals(mode string, answers map[string]jev.Answer) []string {
	var offered []string
	for _, goal := range offerOrder {
		answer := answers[offersQuestionPrefix+goal]
		if goal == mode || (answer.Noul != nil && *answer.Noul > checkThreshold) {
			offered = append(offered, goal)
		}
	}
	return offered
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

// guestOnly says what going on without an account is, and what it is not.
const guestOnly = "A control that sends, opens, or switches between account forms (sign in, create an account, reset a " +
	"password), even one that also applies, needs an account and is not one. "

// accountSteps steer every pick on a step that asks for an account: going on
// without one comes first; otherwise the pick does the account goal the run chose
// (from what the site offered and how it answered earlier steps).
const accountSteps = "When the page offers a way to go on with the application without signing in or creating an account, " +
	"pick that control over signing in or creating an account, whatever account goal the page state gives. " + guestOnly +
	"Otherwise, on a step that needs an account, do the account goal given in the page state: when the page shows the goal's own form, pick the control that sends it; when it shows another " +
	"form or only choices, pick the control that opens the goal's form, or the one that leads toward it (the way to use an " +
	"email and password, where the other account forms are offered). A step that asks only for the account's email is on the way to " +
	"every account form: pick the control that sends it. Never pick one that signs in through another service. "

// dialogSteps steer every pick when a dialog is open over the page: the dialog is
// the step, and what it covers cannot be clicked. A dialog that asks how to start
// is answered by starting on this site, never through another service.
const dialogSteps = "When a dialog is open over the page, that dialog is the current step: pick only among the controls " +
	"inside it, never a control marked covered (it sits behind the dialog, and clicking it does nothing). " +
	"When the dialog asks how to start the application, pick the way that starts it on this site with the applicant " +
	"entering their details: applying manually first, else starting from an uploaded résumé. Never pick one that " +
	"reuses a previous application or applies through another service's account. "

// verifySteps steer a pick on a step that sends a verification code: it goes to email.
const verifySteps = "When the step asks where to send a verification code, pick the control that sends it once the email " +
	"choice is selected, never one that sends it to a phone. " + emailOnly

// repairSteps steer a pick on a form that still reports problems after it was sent:
// a problem inside an entry that is shown collapsed is fixed by opening that entry.
const repairSteps = "When the page says a saved entry or section still has fields to fix (an entry marked with errors or " +
	"fields to fix, shown collapsed so its fields are not on the page), pick the control that opens that entry for editing " +
	"(often an icon button such as a pencil, whose surroundings name the entry); the run fills what it opens. When the page " +
	"shows an entry form that is open for editing, pick the control that saves or keeps that entry, not the one that sends the " +
	"whole application. Never pick a control that only scrolls to, jumps to, or lists the problems, deletes an entry, or adds a " +
	"new empty entry. "

// thisRoleOnly keeps every pick on the application to this one role: a site's
// talent community is a different, general form that never applies to it.
const thisRoleOnly = "Never pick a control that joins a talent community or leaves the applicant's details or résumé to be " +
	"contacted about future openings in general: that is a different form from applying to this role, and it never leads " +
	"to this application. A control on this role's own posting that answers this role is the way to apply, whatever its " +
	"wording: some sites word their apply control as interest in the role, and it opens the application for it. "

// minRequirementConfidence is the least confidence Jev must have in an outstanding
// requirement before the run clicks it ahead of the forward control: an unsure
// pick on a page that reports nothing outstanding would only undo work.
const minRequirementConfidence = 0.5

// requirementInstructions ask for the best next step when the page is not yet
// complete: what it still reports as required may be done through a control
// rather than a field, and doing it comes before sending or moving on.
const requirementInstructions = "Before this step can be sent or moved on, does the page report something still required " +
	"that is done through one of the listed controls rather than by typing into or choosing in a field: an assessment or " +
	"questionnaire to take (on this site or a partner's), a document or section to complete, a statement to open and " +
	"acknowledge, or a required item the page names as an issue still to fix? Judge from the page messages and the text " +
	"around each control, whatever its wording. When it does, pick the control that starts or completes that requirement: " +
	"doing it is the next step, ahead of the control that sends or moves the application on. A required list of entries " +
	"(education, work history) with none yet is completed by the control that adds one. An entry the page already lists " +
	"but marks with errors or fields to fix is completed by the control that opens it for editing (often an icon whose " +
	"surroundings name the entry): never one that deletes or removes it, which only loses what the page holds. Never pick a control that " +
	"only scrolls to, jumps to, or lists the issues, the control that sends or moves the application on, or one that goes " +
	"back, cancels, saves a draft, signs out, or leaves the application. Never pick a control that imports or uploads a " +
	"profile or résumé to fill the form in, starts the form over, or otherwise replaces answers already given: that undoes " +
	"the work instead of completing it. When the page reports nothing outstanding, choose none. " + dialogSteps

// noRequirement is the "nothing outstanding through a control" answer.
const noRequirement = "Nothing the page reports as still required is done through a listed control: every requirement is " +
	"met, or what remains is a field to fill or fix."

// minCommitConfidence is the least confidence Jev must have in the control that
// saves what the run opened before the run clicks it: an unsure pick between a
// save and a cancel would lose the entry.
const minCommitConfidence = 0.5

// commitInstructions ask which of the opened form's own controls saves it. The
// controls are described by what they do, so no wording is quoted.
const commitInstructions = "The run opened a form inside this page to complete what the page requires (an entry the " +
	"page asks for, such as an education or work history item, a document, or a section to complete) and filled it in. " +
	"Its controls are the ones marked as in the form the run opened. Which of them saves or adds that entry so the page " +
	"keeps it? Judge by what the control does, whatever its wording. Never pick one that cancels, closes, discards, " +
	"deletes, or removes the entry, and never one that sends or moves the whole application on."

// noCommit is the "none of the opened form's controls saves it" answer.
const noCommit = "None of the opened form's controls saves or adds it: the page keeps what was entered as it is, " +
	"or the form only offers ways to cancel, close, or remove it."

// controlInstructions describe controls only by what they do: sites word them
// any way they like, so no wording is quoted here.
func controlInstructions(intent string) string {
	if intent == IntentAdvance {
		return "The applicant has finished filling this page. Which control moves the application to its next step, " +
			"or sends it on the last step? Judge by what the control does on this page, whatever its wording, " +
			"an arrow, or an icon. " + thisRoleOnly + dialogSteps + repairSteps + verifySteps + accountSteps +
			"Never pick a control that goes back, cancels, leaves the application, saves a draft, signs out, " +
			"signs in through another service, or opens another site, and never a link in the site's header, menu, or footer " +
			"that opens another page of the site rather than sending this form. A step listed in the application's progress " +
			"tracker (the row of step names that shows where the applicant is) is never the way forward when it is the " +
			"current step or one already done: clicking it returns to that step. " +
			"Prefer an enabled control, but a forward control that looks disabled is still the forward control: " +
			"many forms only grey it out until their fields are valid, and clicking it shows what they still need. " +
			"Choose none only when nothing here moves the application forward."
	}
	return "Which control starts or continues an application for this role? On a job posting it is the control " +
		"that opens the application. When the page is already an application form or an account step, pick the " +
		"control that moves it forward instead. " + thisRoleOnly + dialogSteps + verifySteps + accountSteps +
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
	if len(q.Scope) > 0 {
		fmt.Fprintf(&b, "The run opened a form inside this page (%q) to complete what the page requires, and filled it in. "+
			"Its controls are marked \"in the form the run opened\".\n", clip(firstNonEmpty(q.ScopeTitle, "a form"), maxControlLine))
	}
	if goal, ok := accountGoals[q.AccountGoal]; ok {
		fmt.Fprintf(&b, "Account goal on this page, only when it offers no way to go on without an account: %s (%s).\n", q.AccountGoal, goal)
	}
	writeAccountHistory(&b, q.Account)
	if q.LastClick != "" {
		fmt.Fprintf(&b, "The run's last action: it clicked %q (%s) %d seconds ago.\n",
			clip(q.LastClick, maxControlLine), lastClickRole(q.LastClickRole), q.LastClickAgo)
	}
	if len(q.NewText) > 0 {
		b.WriteString("\nText that appeared on the page since the run's last action:\n")
		for _, line := range q.NewText {
			fmt.Fprintf(&b, "- %s\n", clip(line, maxControlLine))
		}
	}
	b.WriteString("\nPage text:\n")
	b.WriteString(clipEnds(q.Text, maxPageText))
	b.WriteString("\n\nControls on the page:\n")
	if len(controls) == 0 {
		b.WriteString("(none)\n")
	}
	for i, control := range controls {
		fmt.Fprintf(&b, "%s_%d: %s\n", controlKeyPrefix, i, describeControl(control))
	}
	return b.String()
}

// lastClickRole says in words what the run's last click did.
func lastClickRole(role string) string {
	switch role {
	case RoleSubmit:
		return "the control that sends the application"
	case RoleApply:
		return "the control that opens the application"
	case RoleResolve:
		return "a control for something the page seemed to still require; it does not move the application on"
	case RoleCommit:
		return "the control that saves what the run opened inside the page; it does not move the application on"
	default:
		return "the control that moves the application to its next step"
	}
}

// openDialog is the name of the dialog on top, when one is open: a dialog left open
// beneath a newer one has its controls covered.
func openDialog(controls []Control) string {
	for _, control := range controls {
		if control.Dialog != "" && !control.Covered {
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
	if c.Near != "" {
		line += " beside \"" + clip(c.Near, maxControlNear) + "\""
	}
	if c.Dialog != "" {
		line += " in dialog \"" + clip(c.Dialog, 60) + "\""
	}
	if c.Opened {
		line += " in the form the run opened"
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
	b.WriteString("\nPage text:\n" + clipEnds(q.Text, maxPageText))

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
