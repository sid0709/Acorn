package agent

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
)

// turn is one step of the run as the model lived it.
type turn struct {
	number int
	// text is what the model was told beside the screenshot, notes included, exactly as it
	// was sent; images are the screenshots (one, or a survey's), released once the turn is older than
	// the screenshots the history still sends. text stays until the turn is folded into a summary.
	text   string
	images []string
	// answer is the model's reply as JSON, replayed as its own earlier turn.
	answer string
	// summary is the one line that stands for the turn once it is folded away.
	summary string
}

// session is one application run: the applicant, the model's memory, and its history.
type session struct {
	id  string
	key string // the person's OpenRouter key; held in memory only
	// openaiKey is the person's OpenAI key, for the decisions asked of OpenAI; held in memory only.
	openaiKey string
	auth      applicant.Auth // whose profile and files the run reads; held in memory only
	start     Start
	snap      applicant.Snapshot
	system    string
	created   time.Time

	mu      sync.Mutex
	touched time.Time
	// stepStarted is when the server got the look being answered, for the trace's timing.
	stepStarted time.Time
	// seq counts every step asked, including the ones that failed, and names the trace files.
	seq   int
	step  int
	memo  string
	job   string
	turns []turn
	// folded holds one line per step that left the recent history, oldest first.
	folded []string
	// lastSig is the previous screenshot's signature, for telling whether the page changed.
	lastSig []uint8
	// stale counts steps in a row where the screen did not change.
	stale int
	// resume is the résumé chosen for this run, once chosen.
	resume string
	usage  Usage
	// finished is set once a step ended the run; stoppedFor is why, in the words of the step.
	finished   bool
	stoppedFor string
	// stepLimit is the most steps the run may take so far: Continue after the limit adds a whole
	// budget, so a run the person is still helping is not cut off again at once.
	stepLimit int

	// plan is what the model planned and has not yet been sent, one chunk per check. verify
	// is what the screen should show after the chunk just sent, until that chunk is checked.
	plan   []chunk
	verify string
	// message is the model's latest line for the person, shown again while a plan runs on.
	message string
	// jd is the job description read from the page text, "" until one is found; jdSeen holds
	// the pages already judged and jdChecks how many that is.
	jd       string
	jdSeen   map[string]bool
	jdChecks int
	// vetted holds what the decision model already said about a control or window, by its description.
	vetted map[string]VetVerdict
	// fallback is the résumé folder to offer when there is no job description ("" when none is set).
	fallback string
	// pendingUpload is an upload held until the person says which résumé to send.
	pendingUpload *Action
	// byID holds the actions of the model's latest plan by id, to match a result to its action.
	byID map[string]Action
	// pickerSeen holds the results already acted on for a file picker a click opened, and
	// pickerTried the points where the agent has uploaded for the model, so it does so once.
	pickerSeen  map[string]bool
	pickerTried map[[2]int]bool
	// planned and sent count the actions of the model's latest plan and how many went out, in
	// how many parts.
	planned, sent, parts int
	// maxActions is the most actions one answer of this run may plan.
	maxActions int
	// checks is whether a decision model checks the screen between runs of the model's actions.
	checks bool
	// carried holds the results of actions sent since the model last looked.
	carried []ActionResult
	// notes are things the model is told on its next look, about what its plan did.
	notes []string
	// loadWaits counts waits in a row for a loading page, with no model call.
	loadWaits int
	// checksOff is set once a check failed: the rest of the run goes without them.
	checksOff bool
	// formReady is set once the screen shows an application form or Apply control, so navigation
	// scrolls stop and the driving model plans clicks and typing.
	formReady bool
	// navScrolls counts scroll-only steps sent while looking for the form.
	navScrolls int
	// wantTrace is set when the run asked for its trace in the answers, and pendingTrace is what was
	// recorded since the last answer.
	wantTrace bool
	// wantTraceImages is set when the run asked for the trace's pictures as well as its text.
	wantTraceImages bool
	pendingTrace    *Trace
	// donePasses counts the "done" answers sent back because the screen did not confirm a sent application.
	donePasses int
	// accountSteps counts the steps that typed the account password (sign-in, sign-up, reset).
	accountSteps int
	// stopPasses counts the stops for the applicant that were sent back to finish the page first.
	stopPasses int
	// captchaPasses counts the stops for a human check that were sent back because the screen showed
	// none to pass (stopgate.go); one a run.
	captchaPasses int
	// zones are the photos the extension took of the zones of the plan it just carried out, and
	// anchors a crop of the survey around each target of the plan being carried out, by action id
	// (zones.go).
	zones   []ZoneShot
	anchors map[string]anchor
	// marks binds each point of the plan being carried out to the control it is on, by action id
	// (marks.go).
	marks map[string]MarkRef
	// settled is the parts of the page the model will not come back to (settled.go).
	settled settledState
	// viewport is the window as the last look saw it, to check the pictures sent mid-batch against.
	viewport Viewport
	// planGen counts the plans the model has made, and expect is what the current plan fills in, by
	// zone; reviews are the reviews of its zones running beside it (review.go).
	planGen int
	expect  map[int][]expectation
	reviews reviewState
	// snaps are the photos of open dropdowns sent mid-batch, by action id (probe.go).
	snaps map[string]ShotUpload
	// surveyAgain asks for the next look to be a survey: points of the last plan were not carried
	// out, and the model must see the whole page again to plan them.
	surveyAgain bool
	// probe is a run of the model's actions with dropdowns in it, being carried out by probing them
	// together (probe.go); script the same run being carried out one dropdown at a time (choose.go).
	probe *probeRun
	// script is a run of the model's actions with a dropdown to set in it, being carried out.
	script *script
	// cover is what the run has looked at on the page it is on, in pixels from the top.
	cover coverage
	// commit is the click that sends the page, as the last plan kept it (stopgate.go).
	commit commitState
	// fieldHold is the last stop sent back for the required fields the page reported empty (stopgate.go).
	fieldHold fieldHold
	// listHold counts the sends held on this page for fields the to-do list has empty (sendgate.go).
	listHold listHold
	// alreadyApplied is that the done check read the page as saying the application was sent before.
	alreadyApplied bool
	// heldSend is the click that sends the page or goes on, held from a plan while the to-do list still had
	// empty fields; reviewed is, by zone, whether the photo of each zone of the plan being carried out showed
	// every field as planned; probeUnsure is that a dropdown of it showed no sure option (autosend.go).
	heldSend    *heldSend
	reviewed    map[int]bool
	probeUnsure bool
	// retry holds the fields whose fill did not verify since the model last looked (focus.go); planScrollY
	// is where the page was scrolled when the plan being carried out was made.
	retry       []focusTarget
	planScrollY float64
	// sendRefused is set when the screen showed the page refused the click that sent it: the next plan's
	// send is held for one look (stopgate.go).
	sendRefused bool
	// key is the control that sends the page or goes on to its next step, as the model named it on the
	// page's first survey (key.go); confirmed are the labels of the fields the reviews found filled as
	// planned on confirmedURL, for the stretches settled row by row (settled.go).
	pageKey      *keyControl
	confirmed    []string
	confirmedURL string
	// expectURL is the page the plan whose fields the reviews check (expect) was made on.
	expectURL string
	// fields is the form's to-do list as the model read it on the page's last survey, kept up to date by
	// the reviews (fields.go); fieldsURL the page it is of, and fieldsChanged that the extension has not
	// been sent it since it changed.
	fields        []FieldState
	fieldsURL     string
	fieldsChanged bool
}

// addTrace keeps the trace of an entry until the next answer carries it to the extension.
func (s *session) addTrace(trace *Trace) {
	if trace == nil {
		return
	}
	if s.pendingTrace == nil {
		s.pendingTrace = &Trace{Files: []TraceFile{}}
	}
	s.pendingTrace.Files = append(s.pendingTrace.Files, trace.Files...)
	s.pendingTrace.Timeline += trace.Timeline
}

// takeTrace is what to send with the answer, and forgets it.
func (s *session) takeTrace() *Trace {
	trace := s.pendingTrace
	s.pendingTrace = nil
	return trace
}

// Limits on what a session keeps.
const (
	// maxFoldedLines bounds the run's folded history.
	maxFoldedLines = 80
	// maxSummaryChars bounds one folded line.
	maxSummaryChars = 240
	// maxMemoChars bounds the model's scratchpad, which is told to it on every step.
	maxMemoChars = 2000
	// maxJobChars bounds the job description the model records.
	maxJobChars = 1500
	// approxImageTokens is what a screenshot costs in the history budget.
	approxImageTokens = 1200
)

func newSessionID() (string, error) {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("make session id: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}

// history builds the model's view of the run before the current step: the folded summary,
// then every turn as it was sent and answered. Only the newest keepImages turns still carry
// their screenshots (none by default): the model reads the current screen from the current
// step's own screenshot, and an old one only makes every request bigger to send and to read.
//
// The prompt only ever grows at the end. The provider bills a prompt's tokens at a tenth of the
// price when they repeat the start of an earlier prompt, and the first change anywhere in the
// prompt makes everything after it a new prompt. A turn's screenshot is gone from the first
// request that replays it, and it was never part of an earlier request's replayed start (it
// sat in that request's current message), so with keepImages 0 nothing earlier changes between
// one step and the next. A keepImages above 0 slides a window of screenshots and changes the
// prompt from the oldest kept turn on at every step.
//
// The history is compacted when it passes budget (in estimated tokens), in one go: the oldest
// turns are folded into the summary, so the history is small again and the prompt grows by
// appending for many steps before it is compacted again.
func (s *session) history(keepTurns, keepImages, budget int) []llm.Message {
	if budgetUsed(s) > budget {
		s.compact(keepTurns, budget)
	}
	var out []llm.Message
	if len(s.folded) > 0 {
		out = append(out, llm.Message{
			Role: llm.RoleUser,
			Text: "Earlier in this run (oldest first; your notes below are the full picture):\n- " + strings.Join(s.folded, "\n- "),
		})
	}
	for i, t := range s.turns {
		message := llm.Message{Role: llm.RoleUser, Text: t.text}
		if len(t.images) > 0 && i >= len(s.turns)-keepImages {
			message.Images = t.images
		} else {
			message.Text += "\n(Screenshot no longer kept.)"
		}
		out = append(out, message, llm.Message{Role: llm.RoleAssistant, Text: t.answer})
	}
	return out
}

// releaseImages drops the screenshots of every turn but the newest keepImages, which the
// history would not send again, so a long run does not hold them in memory.
func (s *session) releaseImages(keepImages int) {
	for i := 0; i < len(s.turns)-keepImages; i++ {
		s.turns[i].images = nil
	}
}

// compact makes the history small: only the newest keepTurns turns stay in full, and if that
// is still over budget the oldest turns are folded until it is not.
func (s *session) compact(keepTurns, budget int) {
	for len(s.turns) > keepTurns {
		s.fold()
	}
	for budgetUsed(s) > budget && len(s.turns) > 1 {
		s.fold()
	}
}

// fold moves the oldest turn into the summary lines.
func (s *session) fold() {
	if len(s.turns) == 0 {
		return
	}
	s.folded = append(s.folded, clipText(s.turns[0].summary, maxSummaryChars))
	if len(s.folded) > maxFoldedLines {
		s.folded = s.folded[len(s.folded)-maxFoldedLines:]
	}
	s.turns = s.turns[1:]
}

// budgetUsed estimates the tokens the history takes: text at four characters a token, and
// every screenshot still kept.
func budgetUsed(s *session) int {
	total := 0
	for _, t := range s.turns {
		total += (len(t.text) + len(t.answer)) / 4
		total += len(t.images) * approxImageTokens
	}
	for _, line := range s.folded {
		total += len(line) / 4
	}
	return total + len(s.system)/4
}

// store holds the live sessions. A session nobody has touched for ttl is dropped.
type store struct {
	mu       sync.Mutex
	sessions map[string]*session
	ttl      time.Duration
	now      func() time.Time
}

func newStore(ttl time.Duration, now func() time.Time) *store {
	return &store{sessions: map[string]*session{}, ttl: ttl, now: now}
}

func (st *store) add(s *session) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.sweepLocked()
	st.sessions[s.id] = s
}

func (st *store) get(id string) (*session, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.sweepLocked()
	s, ok := st.sessions[id]
	return s, ok
}

func (st *store) remove(id string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	delete(st.sessions, id)
}

func (st *store) len() int {
	st.mu.Lock()
	defer st.mu.Unlock()
	return len(st.sessions)
}

// sweepLocked drops sessions idle past the ttl. A session in the middle of a step holds
// its own lock and is never idle: touched moves on every step.
func (st *store) sweepLocked() {
	cutoff := st.now().Add(-st.ttl)
	for id, s := range st.sessions {
		if s.lastTouched().Before(cutoff) {
			delete(st.sessions, id)
		}
	}
}

func (s *session) lastTouched() time.Time {
	if s.mu.TryLock() {
		defer s.mu.Unlock()
		return s.touched
	}
	return time.Now() // busy: in the middle of a step
}
