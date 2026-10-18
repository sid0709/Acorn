package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
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
	// ReviewHuman: the page may need something only the applicant can give. It is a hint for the driving
	// model, which decides from the screen; the review itself never ends a run.
	ReviewHuman = "human"
	// ReviewLook: the review could not decide (no decision model, or it failed); the driving model looks.
	ReviewLook = "look"
)

// Questions of a review and the keys their answers come back under.
const (
	askVisibleErrors = "visible_errors"
	askUnanswered    = "unanswered_question"
	askUnticked      = "unticked_consent"
	askGreyedOut     = "continue_greyed_out"
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
	// Blocked are the controls that would continue the application but are disabled, and, when there
	// is one, the unticked boxes of the form: something they need is not done.
	Blocked []string `json:"blocked,omitempty"`
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
	for _, label := range f.Blocked {
		out = append(out, "blocked: "+label)
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
	// Survey is the whole page as screenshots from top to bottom, sent when the page is taller than the
	// screen and the page's own state found nothing wrong. The review is made on all of it.
	Survey []SurveyScreen `json:"survey,omitempty"`
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
		askUnanswered:    decide.YesNo("Is there a question or field on these screens of the application form that still looks unanswered: an empty box, a list left on its prompt, or a group of choices with none chosen? Ignore anything marked optional."),
		askUnticked:      decide.YesNo("Is there a checkbox on these screens that the applicant has to tick for the application to go on, such as an agreement, a consent or an acknowledgement, that is still unticked?"),
		askGreyedOut:     decide.YesNo("Is the control that would continue the application (to the next step, or to send it) shown greyed out or disabled, so that it cannot be pressed yet?"),
		askHuman: {
			Type:         decide.TypeChoice,
			Instructions: "Does this page need something only the applicant's own hand can give before the application can go on? Choose none when it does not.",
			Criteria: map[string]string{
				humanCaptcha:  "the page asks the visitor to prove they are human and it is not passed yet: a CAPTCHA, an 'I'm not a robot' box, a picture puzzle, a security challenge. A small badge that only says the page is protected by one does not count.",
				humanCode:     "the page asks for a code that was sent to the applicant's email or phone",
				humanDocument: "the page asks for a document or an ID that only the applicant has, such as a diploma, a transcript, an ID scan or a certificate (not a résumé or a cover letter, which are attached for them)",
				humanNone:     "the page needs none of these",
			},
		},
		askLoading: decide.YesNo("Is the page still loading or changing: a spinner, a progress bar, or a blank or half-drawn page?"),
		askSent:    sentQuestion()[askSent],
	}
}

// reviewProblems are the questions whose "yes" means the page is not done, and what is told of each.
var reviewProblems = []struct{ key, problem string }{
	{askVisibleErrors, "an error or validation message is showing on the page"},
	{askUnanswered, "a question on the page still looks unanswered"},
	{askUnticked, "a box the applicant has to tick is still unticked"},
	{askGreyedOut, "the control that continues is greyed out, so something it needs is not done"},
}

// coverTolerance is how many pixels of a page's top or bottom may be missing from the screens and
// still count as seen (a page's size is a rounding of what it measures).
const coverTolerance = 12

// seesWholePage is whether the screens, each at its own scroll position, between them show the page
// from its top to its bottom with no gap. A page no taller than one screen is seen by one.
func seesWholePage(vp Viewport, screens []SurveyScreen, main float64) bool {
	height := float64(vp.Height)
	positions := []float64{main}
	for _, screen := range screens {
		positions = append(positions, screen.ScrollY)
	}
	sort.Float64s(positions)
	reach := 0.0
	if positions[0] > coverTolerance {
		return false
	}
	for _, y := range positions {
		if y > reach+coverTolerance {
			return false
		}
		reach = math.Max(reach, y+height)
	}
	return reach >= vp.PageHeight-coverTolerance
}

// reviewState is what the decision model reads: every screen of the page, in order, each said where it is.
func reviewState(screenshot string, vp Viewport, survey []SurveyScreen) []decide.Part {
	if len(survey) < 2 {
		return checkState(screenshot)
	}
	parts := []decide.Part{decide.Text(fmt.Sprintf("The whole of a web page the applicant's browser is on, as %d screenshots from its top to its bottom.", len(survey)))}
	for i, screen := range survey {
		parts = append(parts, decide.Text(fmt.Sprintf("Screen %d of %d (from %.0f px down the page, which is %.0f px tall):", i+1, len(survey), screen.ScrollY, vp.PageHeight)), decide.Image(screen.Screenshot))
	}
	return parts
}

// humanHint tells the driving model what a quick read of the page took it to ask for, and that the
// decision is its own: it can attach the résumé and type from the profile, so what only the applicant
// can give is for it to judge from the screenshot.
func humanHint(kind string) string {
	asks := reviewQuestions()[askHuman].Criteria[kind]
	if asks == "" {
		return ""
	}
	return "A quick read of the page took it to be asking for this: " + asks + ". That is only a hint and does not end the run: look at the screenshot yourself. Anything you can do, such as attaching the résumé or a cover letter with upload, or typing an answer from the applicant's details, is yours to do. Stop for the applicant only when the page truly needs something only they can give."
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
		note := "A review after the first draft found these left to do on this page: " + strings.Join(problems, "; ") +
			". Do exactly these, then continue."
		for _, problem := range problems {
			if strings.HasPrefix(problem, "blocked:") {
				// A control that continues is usually greyed out for the moment after it was pressed.
				return note + " A control that is disabled right after it was pressed is usually the page still submitting: wait a moment and look again before deciding anything."
			}
		}
		return note
	case ReviewClean:
		return "A review of the whole page after the first draft found its questions answered, no error showing, and nothing in the way. Go to the control that continues (Next, Continue or Submit) and use it; it may be below the part of the page on screen."
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

	// A page the screens do not show whole cannot be called clean: what is below is not known.
	if !seesWholePage(req.Viewport, req.Survey, req.Viewport.ScrollY) {
		result.Verdict = ReviewLook
		entry.Message = "review: the screens do not show the whole page"
		return a.finishReview(s, entry, nil, result, req.Screenshot), nil
	}
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: reviewState(req.Screenshot, req.Viewport, req.Survey), Questions: reviewQuestions()})
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
	default:
		result.Verdict = ReviewClean
		for _, problem := range reviewProblems {
			if yes(problem.key) >= a.cfg.ReviewErrors {
				result.Verdict = ReviewFix
				result.Problems = append(result.Problems, problem.problem)
			}
		}
	}
	entry.Message = fmt.Sprintf("review: %s (errors %.2f, unanswered %.2f, unticked %.2f, greyed %.2f, loading %.2f, human %s %.2f, sent %.2f, screens %d)",
		result.Verdict, yes(askVisibleErrors), yes(askUnanswered), yes(askUnticked), yes(askGreyedOut), yes(askLoading), kind, sure, yes(askSent), max(1, len(req.Survey)))
	if result.Verdict == ReviewHuman {
		result.Note = humanHint(kind)
	}
	return a.finishReview(s, entry, &call, result, req.Screenshot), nil
}

// finishReview records the review and fills in what the caller needs.
func (a *Agent) finishReview(s *session, entry stepTrace, call *modelCall, result ReviewResult, screenshot string) ReviewResult {
	if result.Note == "" {
		result.Note = reviewNote(result.Verdict, result.Problems)
	}
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
