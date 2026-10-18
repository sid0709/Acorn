package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-agent/decide"
)

// The DOM-first loop (docs 19.4m). After the quick text pass has typed a first draft, the page is
// reviewed, and only what the review cannot settle goes to the driving model:
//
//   - The extension reads the page's own state (required fields still empty, error text, fills that
//     did not take), which costs nothing, and sends it with a screenshot.
//   - When the page has such problems the answer is "fix", with the list, and no model is called: the
//     driving model fixes exactly those.
//   - When it has none, the decision model reads the screenshot for what the page cannot say of
//     itself: an error showing, a check only a person can pass, a page still loading, a page that
//     confirms the application was sent. A clean page goes on to the next control (advance.go).
//
// The decision model only answers yes or no and picks among what exists; the driving model is the one
// that plans and repairs.

// Verdicts of a review.
const (
	// ReviewClean: every required field is answered and nothing is in the way; the page may go on.
	ReviewClean = "clean"
	// ReviewFix: something is left to do or went wrong; the problems say what.
	ReviewFix = "fix"
	// ReviewLoading: the page is still changing; look again in a moment.
	ReviewLoading = "loading"
	// ReviewSent: the screen shows the application was received.
	ReviewSent = "sent"
	// ReviewHuman: only the applicant's own hand can go on; the run ends as need_person.
	ReviewHuman = "human"
	// ReviewLook: the review could not decide (no decision model, or it failed); the driving model looks.
	ReviewLook = "look"
)

// Questions of a review and the keys their answers come back under.
const (
	askVisibleErrors = "visible_errors"
	askHuman         = "human_needed"
	humanNone        = "none"
	humanCaptcha     = "captcha"
	humanCode        = "code"
	humanDocument    = "document"
)

// Limits of one review.
const (
	// maxReviewProblems bounds the problems told to the model, and maxReviewLine each one's length.
	maxReviewProblems = 20
	maxReviewLine     = 90
)

// Errors a caller can tell apart.
var (
	// ErrReviewLimit is a review beyond the most one run may make.
	ErrReviewLimit = errors.New("this run has made all the reviews it may")
)

// ReviewFindings is what the page says of itself after the first draft.
type ReviewFindings struct {
	// Fields is how many plain fields the page shows; 0 means it is not a form.
	Fields int `json:"fields"`
	// Empty are the labels of required fields still empty.
	Empty []string `json:"empty,omitempty"`
	// Errors are visible error messages, and the labels of fields the page marked invalid.
	Errors []string `json:"errors,omitempty"`
	// Failed are the labels of fills the pass made that did not take.
	Failed []string `json:"failed,omitempty"`
}

// problems lists what is left, in the words of the page.
func (f ReviewFindings) problems() []string {
	var out []string
	for _, label := range f.Empty {
		out = append(out, "still empty: "+label)
	}
	for _, label := range f.Failed {
		out = append(out, "did not take: "+label)
	}
	for _, label := range f.Errors {
		out = append(out, "the page shows: "+label)
	}
	return out
}

// ReviewRequest is the page after the first draft.
type ReviewRequest struct {
	URL        string         `json:"url"`
	Title      string         `json:"title"`
	Screenshot string         `json:"screenshot"`
	Viewport   Viewport       `json:"viewport"`
	DOM        ReviewFindings `json:"dom"`
}

// ReviewResult is what the review made of the page.
type ReviewResult struct {
	Verdict  string   `json:"verdict"`
	Problems []string `json:"problems,omitempty"`
	// Note is what the driving model is told on its next look; empty when it needs none.
	Note string `json:"note,omitempty"`
	// Step ends the run when only the person can go on.
	Step  *Step  `json:"step,omitempty"`
	Usage Usage  `json:"usage"`
	Trace *Trace `json:"trace,omitempty"`
}

func reviewQuestions() map[string]decide.Question {
	return map[string]decide.Question{
		askVisibleErrors: decide.YesNo("Does this web page show an error or validation message on its form: red or highlighted text saying a field is required, invalid, missing or wrong, or an error banner? Count messages beside fields."),
		askHuman: {
			Type:         decide.TypeChoice,
			Instructions: "Does this page need something only the applicant's own hand can give before the application can go on? Choose none when it does not.",
			Criteria: map[string]string{
				humanCaptcha:  "the page asks the visitor to prove they are human and it is not passed yet: a CAPTCHA, an 'I'm not a robot' box, a picture puzzle, a security challenge. A small badge that only says the page is protected by one does not count.",
				humanCode:     "the page asks for a code that was sent to the applicant's email or phone",
				humanDocument: "the page asks for a document or an ID the applicant must provide themselves",
				humanNone:     "the page needs none of these",
			},
		},
		askLoading: decide.YesNo("Is the page still loading or changing: a spinner, a progress bar, or a blank or half-drawn page?"),
		askSent:    sentQuestion()[askSent],
	}
}

// humanStop is the end of a run that needs the applicant, by what the page asks.
func humanStop(kind string) (*StopInfo, string) {
	switch kind {
	case humanCaptcha:
		return &StopInfo{Reason: StopCaptcha, Problem: "The page asks you to prove you're not a robot.", Action: "Solve the check on the page, then press Continue."}, "The page needs a check only you can pass."
	case humanCode:
		return &StopInfo{Reason: StopVerification, Problem: "The page asks for a code sent to your email or phone.", Action: "Enter the code on the page, then press Continue."}, "The page needs a code that was sent to you."
	default:
		return &StopInfo{Reason: StopDocument, Problem: "The page asks for a document or ID that Acorn does not have.", Action: "Provide it on the page, then press Continue."}, "The page needs a document only you can provide."
	}
}

// clipList bounds a list of labels from the page: how many, and how long each.
func clipList(items []string) []string {
	var out []string
	for _, item := range items {
		item = strings.Join(strings.Fields(item), " ")
		if item == "" {
			continue
		}
		if len(out) == maxReviewProblems {
			out = append(out, fmt.Sprintf("and %d more", len(items)-maxReviewProblems))
			break
		}
		out = append(out, clipText(item, maxReviewLine))
	}
	return out
}

// reviewNote is what the driving model is told after a review.
func reviewNote(verdict string, problems []string) string {
	switch verdict {
	case ReviewFix:
		return "A review after the first draft found these left to do on this page: " + strings.Join(problems, "; ") +
			". Do exactly these, then continue. Everything else on the page was checked and is answered: do not scroll through it again to check."
	case ReviewClean:
		return "A review after the first draft found every required field on this page answered, no error showing, and nothing in the way. Do not scroll through the page to check it again: go to the control that continues (Next, Continue or Submit) and use it."
	case ReviewSent:
		return "A check reads this screen as showing that the application was sent. Confirm it from the screenshot and report done."
	}
	return ""
}

// Review judges the page after the first draft. A failure here changes nothing for the run: the
// caller goes on to the driving model's own look.
func (a *Agent) Review(ctx context.Context, id string, req ReviewRequest) (ReviewResult, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return ReviewResult{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if s.finished {
		return ReviewResult{}, ErrSessionOver
	}
	if !s.start.Prefill {
		return ReviewResult{}, ErrPrefillOff
	}
	if s.reviews >= a.cfg.MaxReviews {
		return ReviewResult{}, ErrReviewLimit
	}
	s.reviews++
	problems := clipList(req.DOM.problems())
	result := ReviewResult{Verdict: ReviewFix, Problems: problems}
	entry := stepTrace{Seq: s.seq + 1, Step: s.step, At: a.now(), Source: sourceReview, URL: req.URL, Title: req.Title, Viewport: req.Viewport, Memo: s.memo, Job: s.job}
	s.seq++

	// What the page says of itself settles it when there is anything to fix: no model is called.
	switch {
	case len(problems) > 0:
		entry.Message = "review: " + strings.Join(problems, "; ")
		return a.finishReview(s, entry, nil, result, req.Screenshot), nil
	case !a.checksOn(s) || req.Screenshot == "":
		result.Verdict = ReviewLook
		entry.Message = "review: no decision model to read the screen"
		return a.finishReview(s, entry, nil, result, ""), nil
	}

	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: checkState(req.Screenshot), Questions: reviewQuestions()})
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	call := verdict{response: response, prompt: "review of the page after the first draft"}.call(err)
	if err != nil {
		slog.Warn("review check failed; the driving model looks", "session", s.id, "error", err)
		result.Verdict = ReviewLook
		entry.Error = err.Error()
		return a.finishReview(s, entry, &call, result, req.Screenshot), nil
	}
	yes := func(key string) float64 {
		if answer, ok := response.Answers[key]; ok && answer.Noul != nil {
			return *answer.Noul
		}
		return 0
	}
	human := response.Answers[askHuman]
	kind, sure := human.Choice, human.Probabilities[human.Choice]
	switch {
	case yes(askSent) >= a.cfg.DoneConfirm:
		result.Verdict = ReviewSent
	case yes(askLoading) > a.cfg.CheckLoading:
		result.Verdict = ReviewLoading
	case kind != "" && kind != humanNone && sure >= a.cfg.HumanStop:
		result.Verdict = ReviewHuman
	case yes(askVisibleErrors) >= a.cfg.ReviewErrors:
		result.Verdict = ReviewFix
		result.Problems = []string{"an error or validation message is showing on the page"}
	default:
		result.Verdict = ReviewClean
	}
	entry.Message = fmt.Sprintf("review: %s (errors %.2f, loading %.2f, human %s %.2f, sent %.2f)",
		result.Verdict, yes(askVisibleErrors), yes(askLoading), kind, sure, yes(askSent))
	if result.Verdict == ReviewHuman {
		stop, message := humanStop(kind)
		s.finished, s.stoppedFor = true, message
		s.plan, s.verify, s.planned, s.sent, s.parts = nil, "", 0, 0, 0
		result.Step = &Step{Status: StatusNeedPerson, Message: message, Stop: stop, Actions: []Action{}, Number: s.step, Usage: s.usage}
		entry.Status, entry.Stop = StatusNeedPerson, stop
	}
	return a.finishReview(s, entry, &call, result, req.Screenshot), nil
}

// finishReview records the review and fills in what the caller needs.
func (a *Agent) finishReview(s *session, entry stepTrace, call *modelCall, result ReviewResult, screenshot string) ReviewResult {
	result.Note = reviewNote(result.Verdict, result.Problems)
	entry.Usage = s.usage
	var calls []modelCall
	if call != nil {
		calls = append(calls, *call)
	}
	a.record(s, entry, screenshot, calls)
	result.Usage = s.usage
	if result.Trace = s.takeTrace(); result.Trace != nil {
		result.Trace.Seq = s.seq
	}
	if result.Step != nil {
		result.Step.Usage = s.usage
	}
	return result
}
