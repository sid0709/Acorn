// Package agent is the brain of an application run. The extension is its eyes and hands:
// it sends a screenshot and what the page reports about the focused control, the agent
// answers with the next physical actions, and the extension performs them. The agent
// keeps the run's memory, judges whether each action did what it meant, and decides
// when the run is finished or needs the person.
//
// The wire contract below is mirrored by acorn/packages/shared/agent-contract.ts.
package agent

// Action kinds. Every one is something a person does with a mouse and keyboard.
const (
	KindClick       = "click"
	KindDoubleClick = "double_click"
	KindTripleClick = "triple_click"
	KindRightClick  = "right_click"
	KindHover       = "hover"
	KindType        = "type"
	KindKey         = "key"
	KindScroll      = "scroll"
	KindUpload      = "upload"
	KindWait        = "wait"
	// KindChoose is not sent to the extension: it sets a dropdown the page draws itself to an
	// answer given in words. The agent opens it, finds the option and picks it (choose.go).
	KindChoose = "choose"
	// KindSurvey is not sent to the extension: it asks for the next look to be a survey of
	// the whole page (Step.Survey).
	KindSurvey = "survey"
	// KindSnap is an action of the agent's own, never the model's: the extension takes a picture of the
	// page and sends it to the agent at once, so a dropdown that was opened can be looked at (probe.go).
	KindSnap = "snap"
)

// Run statuses the agent reports with each step.
const (
	// StatusWorking: carry out the actions and send the next screenshot.
	StatusWorking = "working"
	// StatusDone: the application was sent, or the run reached the point it was asked to stop at (a
	// run asked to stop before sending ends done with Step.ReadyToSubmit set).
	StatusDone = "done"
	// StatusNeedPerson: something only the person can do (a CAPTCHA, a code, a decision).
	StatusNeedPerson = "need_person"
	// StatusStuck: the agent cannot make progress.
	StatusStuck = "stuck"
	// StatusAsk: the agent asks the person a question and waits. Nothing is done until they
	// answer; the next step carries their answer in Observation.Answer.
	StatusAsk = "ask"
)

// Why a run ended without being done: what the page needs from the person, or why the
// agent could not go on. The model names the first nine; the agent itself the next two.
const (
	StopCaptcha      = "captcha"
	StopVerification = "verification"
	// StopVerificationLink: a link in an email that the applicant must open.
	StopVerificationLink = "verification_link"
	StopIdentity         = "identity"
	StopDocument         = "document"
	StopSignIn           = "sign_in"
	// StopAccountRejected: the site refused the sign-in, the new account and the password reset.
	StopAccountRejected = "account_rejected"
	StopPageProblem     = "page_problem"
	StopOther           = "other"
	// StopJobUnavailable: the page shows there is no online application to make for this job; StopInfo.Kind
	// says how (closed or filled, apply only by email or phone, not a job posting). The model judges it from
	// the screen, the address and the title; the run ends at once, with nothing for the applicant to finish.
	StopJobUnavailable = "job_unavailable"
	StopNoChange       = "no_change"
	StopStepLimit      = "step_limit"
	// StopResumeChoice: no job description was found, so the agent could not choose a résumé,
	// and the person chose to pick one themselves.
	StopResumeChoice = "resume_choice"
)

// How a job is unavailable (StopInfo.Kind with StopJobUnavailable), in the model's judgment.
const (
	// UnavailableExpired: the posting is closed or filled, or the link led to a careers home page or a search.
	UnavailableExpired = "expired"
	// UnavailableNoOnlineApply: applications are taken only by email, phone, post or in person.
	UnavailableNoOnlineApply = "no_online_apply"
	// UnavailableNotAJob: the page is not a job posting or an application at all.
	UnavailableNotAJob = "not_a_job"
)

// What a click the model marks does beyond the click (Action.Commit): it goes on to another page of the
// form, or it sends the application to the employer. The model judges which from the screen; a run asked
// to stop before sending holds back every CommitSend (sendgate.go).
const (
	CommitNext = "next"
	CommitSend = "send"
)

// The answers to the question the agent asks when it cannot choose a résumé.
const (
	AskResume         = "resume"
	AnswerUseFallback = "use_fallback"
	AnswerChooseOwn   = "choose_own"
)

// AskOption is one answer the person may give.
type AskOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Ask is a question for the person, with the answers they may give.
type Ask struct {
	ID       string      `json:"id"`
	Question string      `json:"question"`
	Options  []AskOption `json:"options"`
}

// StopInfo says, for the person, why the run ended without being done: Reason is one of the
// Stop* values, Problem what the page needs or what went wrong, Action what to do about it. Kind is
// set with StopJobUnavailable only: one of the Unavailable* values.
type StopInfo struct {
	Reason  string `json:"reason"`
	Kind    string `json:"kind,omitempty"`
	Problem string `json:"problem"`
	Action  string `json:"action"`
}

// Viewport describes the screenshot and the page behind it. Every coordinate in an
// action is in the screenshot's own pixels, with (0, 0) at its top left.
type Viewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	// ScrollX and ScrollY are the page's scroll offset; PageWidth and PageHeight its
	// whole size, all in screenshot pixels. They say how much page lies off screen.
	ScrollX    float64 `json:"scrollX"`
	ScrollY    float64 `json:"scrollY"`
	PageWidth  float64 `json:"pageWidth"`
	PageHeight float64 `json:"pageHeight"`
}

// Focus is what the page reports about the control that has keyboard focus. A screenshot
// cannot show a native list's options or a password's length, so the page says.
type Focus struct {
	Tag      string   `json:"tag"`
	Type     string   `json:"type,omitempty"`
	Label    string   `json:"label,omitempty"`
	Value    string   `json:"value,omitempty"`
	Checked  *bool    `json:"checked,omitempty"`
	Options  []string `json:"options,omitempty"`
	Multiple bool     `json:"multiple,omitempty"`
	Required bool     `json:"required,omitempty"`
	Invalid  string   `json:"invalid,omitempty"`
}

// What a click set off beyond the click itself, for ActionResult.Opened.
const (
	// OpenedFilePicker: the click opened the browser's file picker. The extension intercepts it,
	// so nothing is shown and no file is chosen; only an upload action attaches a file.
	OpenedFilePicker = "file_picker"
)

// ActionResult is what happened to one action the agent asked for.
type ActionResult struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Detail string `json:"detail,omitempty"`
	// Opened names something the action set off that a screenshot cannot show (OpenedFilePicker).
	Opened string `json:"opened,omitempty"`
}

// Observation is what the extension sees on one step.
type Observation struct {
	// Screenshot is a data URL (image/jpeg or image/png) of the visible page.
	Screenshot string   `json:"screenshot"`
	URL        string   `json:"url"`
	Title      string   `json:"title"`
	Viewport   Viewport `json:"viewport"`
	Focus      *Focus   `json:"focus,omitempty"`
	// Notes are things the screenshot cannot show: a dialog the browser closed, a file
	// that downloaded, a tab the page opened.
	Notes []string `json:"notes,omitempty"`
	// Survey is the whole page as screenshots from top to bottom, each at its own scroll
	// position, sent on the first look of a page and when the model asks. The model plans the
	// whole form from them; each action names the screen its point is measured on.
	Survey []SurveyScreen `json:"survey,omitempty"`
	// ZoneShots are the photos of the zones of the plan just carried out, each taken when the last
	// action of its zone was done (a fast-fill run; docs 19.4m). Zone is the survey screen the
	// actions of the zone were measured on.
	ZoneShots []ZoneShot `json:"zoneShots,omitempty"`
	// PageText is the page's visible text, sent when the page changed since the last step.
	// The agent reads it for the job description, which a screenshot may have scrolled past.
	PageText string `json:"pageText,omitempty"`
	// Answer is the person's answer (an AskOption id) to the question the last step asked.
	Answer string `json:"answer,omitempty"`
	// Results answer the actions of the step before.
	Results []ActionResult `json:"results,omitempty"`
	// Marks are the page's controls and where each sits on the page, so a point of a plan is bound to
	// the control it is on (marks.go). Sent with each look of a run that surveys.
	Marks []ControlMark `json:"marks,omitempty"`
	// Layout is where the form moved since the look before: the settled stretches are placed from it
	// (settled.go). Empty when nothing moved.
	Layout []LayoutMove `json:"layout,omitempty"`
	// Look names the look, the same on a step the extension sends again after a failure, so the move
	// in Layout is placed once. Empty from an extension that does not name its looks.
	Look string `json:"look,omitempty"`
	// List is the list of choices open on the page at this look, as the page names and places its
	// options (an ARIA listbox or menu); nil when the page names none. Only where its options are drawn
	// is used: they are numbered on the picture the decision model reads (listread.go).
	List *OpenList `json:"list,omitempty"`
}

// OpenList is a list of choices open on the page, as the page names its options, in the order they
// are drawn (so the n-th is reached with n-1 ArrowDown from the first). Only the boxes are used: what
// the options are called is read from the picture (listread.go).
type OpenList struct {
	Options []string `json:"options"`
	// Boxes is where each option is drawn, one per option in the same order (screenshot pixels from the
	// page's top left, as marks are), when the page could say: the pick is a click on the option.
	Boxes []Rect `json:"boxes,omitempty"`
}

// optionBox is where the n-th option (from 0) is drawn, when the page said.
func (l *OpenList) optionBox(index int) (Rect, bool) {
	if l == nil || index < 0 || index >= len(l.Boxes) || len(l.Boxes) != len(l.Options) {
		return Rect{}, false
	}
	return l.Boxes[index], l.Boxes[index].finite()
}

// Rect is a box on the page, in screenshot pixels from the page's top left.
type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// ControlMark is one control of the page (an input, a dropdown, a button, a check, a file field, a
// link): a stable ID, what kind it is, where it sits, and Box, the field it belongs to: the largest
// box around it that holds no other control, so a point on the control's own label is on its field.
// Label is what the page calls it (its label, aria-label, placeholder, or a button's text). Entry is
// the part of the control's own box that is not its label, when the label is printed inside the box
// (a question's words inside a bordered field): the place to click or type. Required, Empty and
// Invalid are what the page says of the control's state; the agent decides nothing by them (or by Kind):
// the pictures say what a control is and holds, the page only where it is.
type ControlMark struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Rect
	Box      *Rect  `json:"box,omitempty"`
	Label    string `json:"label,omitempty"`
	Entry    *Rect  `json:"entry,omitempty"`
	Required bool   `json:"required,omitempty"`
	Empty    *bool  `json:"empty,omitempty"`
	Invalid  bool   `json:"invalid,omitempty"`
	// Group is the group a radio button, or a check box of a shared name, answers one question with, and
	// Question that question as the page prints it (a fieldset's legend), when the page says. Such a
	// control is empty while none of its group is ticked, and required when the page marks any of them so.
	Group    string `json:"group,omitempty"`
	Question string `json:"question,omitempty"`
}

// The kinds of control the page reports (control-marks-page.ts).
const (
	MarkKindInput  = "input"
	MarkKindSelect = "select"
	MarkKindCheck  = "check"
	MarkKindFile   = "file"
	MarkKindButton = "button"
	MarkKindLink   = "link"
)

// isField is whether a kind of control is filled rather than pressed: anything but a button or a link.
func isField(kind string) bool {
	return kind != MarkKindButton && kind != MarkKindLink
}

// MarkRef is the control a point was bound to when it was planned, as it sat then. The extension finds
// the same control by ID when the point is acted on, and the difference of the two places is how far
// the point has moved. Label and Kind stay on the agent: the point is checked against the label.
type MarkRef struct {
	ID string `json:"id"`
	Rect
	Label string `json:"-"`
	Kind  string `json:"-"`
}

// LayoutMove is a move of the form between two looks, in old page positions (screenshot pixels). The
// controls from At down moved by Dy; what lay between From and At is where it happened (something
// appeared or went), so nothing there is known to be as it was.
type LayoutMove struct {
	From float64 `json:"from"`
	At   float64 `json:"at"`
	Dy   float64 `json:"dy"`
}

// SurveyScreen is one screenshot of a survey: the page scrolled to ScrollY (in screenshot
// pixels, as Viewport.ScrollY is).
type SurveyScreen struct {
	Screenshot string  `json:"screenshot"`
	ScrollY    float64 `json:"scrollY"`
}

// Span is a stretch of the page, in screenshot pixels from its top.
type Span struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
}

// SettledMap is the parts of a page the model will not come back to (painted blue on the page's
// minimap): the page's height when they were settled, so the extension can tell the page changed.
// Fence is how far down the page (screenshot pixels) the plan being carried out leaves things as they
// are: it begins at the first point it acts on. A height change does not delete what is below it.
// The extension says where the controls moved (Observation.Layout), and the stretches follow them: a
// stretch moves with the controls it lies among, and what lies where something appeared is no longer
// settled. No control moved and the page grew: the new pixels are at the bottom and the coordinates
// still hold.
type SettledMap struct {
	PageHeight float64 `json:"pageHeight"`
	Fence      float64 `json:"fence"`
	Spans      []Span  `json:"spans"`
	// Key is the band round the control that sends the page or goes on (key.go), painted red; nil when none is known.
	Key *Span `json:"key,omitempty"`
}

// ZoneShot is the screenshot taken when a zone of a plan was done: the zone's number and where the
// page was scrolled to (in screenshot pixels).
type ZoneShot struct {
	Zone       int     `json:"zone"`
	Screenshot string  `json:"screenshot"`
	ScrollY    float64 `json:"scrollY"`
}

// Action is one thing to do. Which fields apply depends on Kind; the others are nil or zero.
type Action struct {
	ID   string   `json:"id"`
	Kind string   `json:"kind"`
	X    *float64 `json:"x,omitempty"`
	Y    *float64 `json:"y,omitempty"`
	// Text is typed into the focused control (KindType).
	Text string `json:"text,omitempty"`
	// Secret marks typed text as a password or a code: it never appears in a log.
	Secret bool `json:"secret,omitempty"`
	// Keys is one key or chord ("Enter", "Control+a", "ArrowDown") or several, space separated.
	Keys string `json:"keys,omitempty"`
	// DX and DY scroll by that many screenshot pixels; positive goes right and down.
	DX float64 `json:"dx,omitempty"`
	DY float64 `json:"dy,omitempty"`
	// Ms is how long to wait (KindWait).
	Ms int `json:"ms,omitempty"`
	// Resume is a résumé id from the session's list (KindUpload). Empty lets the agent choose.
	Resume string `json:"resume,omitempty"`
	// FileName is set by the agent on KindUpload once the résumé is chosen.
	FileName string `json:"fileName,omitempty"`
	// ScrollTo, when set, is the scroll position (screenshot pixels) the page must be at before
	// the action, because its point was measured on that screen of a survey; PageHeight is the
	// page's height then, so the extension can tell the page changed shape since and refuse.
	ScrollTo   *float64 `json:"scrollTo,omitempty"`
	PageHeight float64  `json:"pageHeight,omitempty"`
	// Zone is the survey screen (from 1) the action belongs to in a fast-fill run, so the extension
	// can take a photo when the last action of a zone is done. Typing, keys and waits belong to the
	// zone of the action before them. 0 when the run is not fast-fill or the look was one screen.
	Zone int `json:"zone,omitempty"`
	// Mark is the control the point was bound to when it was planned (marks.go), set by the agent as
	// the action goes out. The extension finds that control again to know where the point is now.
	Mark *MarkRef `json:"mark,omitempty"`
	// Label is what the model called the control at the point, as the page names it. It stays on
	// the agent: the point is checked against it before the action is carried out.
	Label string `json:"-"`
	// Commit is what the model said this click does beyond the click: CommitNext goes on to another page
	// of the form, CommitSend sends the application to the employer; "" is an ordinary click. It stays on
	// the agent: either is held back when part of the plan could not be carried out (pointcheck.go), and
	// a run asked to stop before sending never sends a CommitSend (sendgate.go).
	Commit string `json:"-"`
	// Check is what the screen should show once this action has run, as the model expected.
	// It stays on the agent: the extension never sees it.
	Check string `json:"-"`
}

// Step is the agent's answer to one observation.
type Step struct {
	// Status says what the run does next.
	Status string `json:"status"`
	// Message is one line for the person: what the agent is doing, or why it stopped.
	Message string `json:"message"`
	// Stop says why the run ended, when it ended as need_person or stuck.
	Stop *StopInfo `json:"stop,omitempty"`
	// ReadyToSubmit is set on the done step of a run asked to stop before sending (Start.StopBeforeSubmit,
	// or the server's own switch): every field is filled and the control that sends the application was
	// not pressed. A done step without it is an application the page confirmed as sent.
	ReadyToSubmit bool `json:"readyToSubmit,omitempty"`
	// Ask is the question the run waits on, when Status is StatusAsk.
	Ask *Ask `json:"ask,omitempty"`
	// Survey asks the extension to make its next look a survey of the whole page.
	Survey bool `json:"survey,omitempty"`
	// Settled is the parts of the page the model will not come back to, sent when they changed: the
	// extension does not take them again in a survey, and draws them on the minimap.
	Settled *SettledMap `json:"settled,omitempty"`
	// Fields is the form's to-do list as the model read it from the pictures, sent when it changed: every
	// question, where it is (screenshot pixels from the page's top), and whether it is answered (fields.go).
	Fields []FieldState `json:"fields,omitempty"`
	// Actions run in order, then the extension sends a new screenshot.
	Actions []Action `json:"actions"`
	// Number is this step's place in the run, from 1.
	Number int `json:"number"`
	// Usage is what the model has cost the run so far.
	Usage Usage `json:"usage"`
	// Dropped says which actions the agent refused to send and why, so the log shows it.
	Dropped []string `json:"dropped,omitempty"`
	// Trace is the trace of the entries recorded since the last answer, when the run asked for it.
	Trace *Trace `json:"trace,omitempty"`
}

// Usage is the run's model use so far. Cost is everything the run has spent, the checks
// included; CheckCost is the part of it the decision model's checks cost.
type Usage struct {
	Calls        int     `json:"calls"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	CachedTokens int     `json:"cachedTokens"`
	Cost         float64 `json:"cost"`
	// Checks is how many times the decision model looked at the screen instead of the driving model.
	Checks    int     `json:"checks"`
	CheckCost float64 `json:"checkCost"`
}

// Start opens a session on the page the run begins at.
type Start struct {
	URL   string `json:"url"`
	Title string `json:"title"`
	// StopBeforeSubmit makes the run stop at the control that sends the application.
	StopBeforeSubmit bool `json:"stopBeforeSubmit"`
	// Trace asks for the run's trace in the answers: the files a trace folder would hold (what the
	// model was sent and answered, how long each call took) come back with each step, for the
	// extension to keep in its own log. The server writes and keeps nothing for it.
	Trace bool `json:"trace,omitempty"`
	// TraceImages asks for the trace's pictures too (the screenshot with each action drawn on it, a
	// survey screen's likewise): hundreds of kilobytes a step, so only a build made for debugging asks.
	// Without it the trace that comes back is text alone, which is a few kilobytes gzipped.
	TraceImages bool `json:"traceImages,omitempty"`
	// Survey lets the run look at a whole long page as several screenshots from top to bottom
	// (the extension scrolls the page to take them). Off by default: the model then sees only the
	// current screen, as a person does, and is not told surveys exist.
	Survey bool `json:"survey,omitempty"`
	// FastFill asks for the fast way of filling a page: one plan for the whole page, carried out
	// zone by zone with the checks done on the side. Off by default, the run goes step by step. The
	// agent only records the switch for now (docs 19.4m); nothing behaves differently with it on.
	FastFill bool `json:"fastFill,omitempty"`
	// Memory is what a stopped run knew, kept by the extension, to start a run that goes on from it
	// when the server forgot the session (it restarted, or the session expired).
	Memory *Memory `json:"memory,omitempty"`
}

// Memory is the part of a run that is costly to find again and does not depend on the history of
// its steps: the notes and the job the model recorded, the job description read from the page, the
// résumé chosen from it, and whether the application form was already found. The extension keeps it
// when a run stops, so Continue goes on from it even when the server's session is gone.
type Memory struct {
	Memo      string `json:"memo,omitempty"`
	Job       string `json:"job,omitempty"`
	JD        string `json:"jd,omitempty"`
	Resume    string `json:"resume,omitempty"`
	FormReady bool   `json:"formReady,omitempty"`
}

// TraceFile is one file of a run's trace, returned to the extension. Text holds a text file;
// Data holds an image as base64 (no data-URL prefix).
type TraceFile struct {
	Name string `json:"name"`
	Text string `json:"text,omitempty"`
	Data string `json:"data,omitempty"`
}

// Trace is what a step (or the run's start) adds to the trace. The images the extension took
// itself (the screenshots) are not returned: only the files only the agent can make.
type Trace struct {
	// Seq is the entry the answer is for, as its trace files are numbered (001.json): the
	// extension names the screenshot it took for that look the same way. Zero at the run's start.
	Seq   int         `json:"seq,omitempty"`
	Files []TraceFile `json:"files"`
	// Timeline is this entry's line of timeline.txt (empty at the start of the run).
	Timeline string `json:"timeline,omitempty"`
}

// ResumeInfo is one résumé the agent may upload.
type ResumeInfo struct {
	ID       string `json:"id"`
	FileName string `json:"fileName"`
	Size     int64  `json:"size"`
}

// Started is the answer to Start.
type Started struct {
	SessionID string       `json:"sessionId"`
	Resumes   []ResumeInfo `json:"resumes"`
	// Trace holds the run's start (session.json, system.txt) when the run asked for a trace.
	Trace *Trace `json:"trace,omitempty"`
	// FastFill and Survey are what the run really uses: the server may turn them on for every run
	// (Config.FastFill), and a fast-fill run surveys. The extension follows them.
	FastFill bool `json:"fastFill,omitempty"`
	Survey   bool `json:"survey,omitempty"`
}

// Continued is a run taken back up: the step it stopped at and what it has spent, so the
// extension's counters go on from there.
type Continued struct {
	Number int   `json:"number"`
	Usage  Usage `json:"usage"`
}
