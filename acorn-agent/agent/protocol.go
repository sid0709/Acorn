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
)

// Run statuses the agent reports with each step.
const (
	// StatusWorking: carry out the actions and send the next screenshot.
	StatusWorking = "working"
	// StatusDone: the application was sent, or the run reached the point it was asked to stop at.
	StatusDone = "done"
	// StatusNeedPerson: something only the person can do (a CAPTCHA, a code, a decision).
	StatusNeedPerson = "need_person"
	// StatusStuck: the agent cannot make progress.
	StatusStuck = "stuck"
)

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

// ActionResult is what happened to one action the agent asked for.
type ActionResult struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Detail string `json:"detail,omitempty"`
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
	// Results answer the actions of the step before.
	Results []ActionResult `json:"results,omitempty"`
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
	// Actions run in order, then the extension sends a new screenshot.
	Actions []Action `json:"actions"`
	// Number is this step's place in the run, from 1.
	Number int `json:"number"`
	// Usage is what the model has cost the run so far.
	Usage Usage `json:"usage"`
	// Dropped says which actions the agent refused to send and why, so the log shows it.
	Dropped []string `json:"dropped,omitempty"`
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
}
