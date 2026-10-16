package agent

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-agent/decide"
)

// A form is sent half empty when the part of the page nobody looked at held a required question.
// The model sees one screen at a time, so before the application goes out the agent looks at the
// parts of the page the run has not seen, with the decision model (cheap and quick, one look a
// second or so) rather than the driving model: it scrolls to each, asks whether anything there
// would stop the form being sent, and scrolls back. Only when something does is the driving model
// called, with the page scrolled to it. The agent never fills anything in itself.
//
// It begins at one of two points: the model plans a click that sends the application (the
// decision model says which marked point it is) while parts of the page are unseen, or a run
// that was asked to stop before sending says it is ready while parts are unseen.

// The decision model's questions for the review.
const (
	askSubmitPoint = "submit_point"
	askReviewIssue = "review_issue"
	// pointNone is the answer to askSubmitPoint when no marked point sends the application.
	pointNone = "none"
)

// reviewPrefix starts the ids of the scrolls the review sends, so their results are not
// shown to the driving model as results of its own actions.
const reviewPrefix = "rv"

// reviewMessage is the line the person sees while the review runs.
const reviewMessage = "Checking the rest of the page before sending."

// What the review is doing.
const (
	// reviewWaiting: the actions planned before the send are still running.
	reviewWaiting = "waiting"
	// reviewSweeping: looking at the parts of the page not seen, one scroll at a time.
	reviewSweeping = "sweeping"
	// reviewReturning: scrolling back to where the held actions were planned.
	reviewReturning = "returning"
)

// Bounds on one review.
const (
	// maxReviewScrolls is the most scrolls one sweep takes, however long the page is.
	maxReviewScrolls = 14
	// maxReviewReturns is how many times it tries to scroll back before the model looks.
	maxReviewReturns = 2
	// returnTolerance is how far from where the held actions were planned the page may be
	// for them to still land where they were aimed (screenshot pixels).
	returnTolerance = 24.0
	// sweepOverlap is how far above a gap's start a scroll lands, so a question on the seam is whole.
	sweepOverlap = 24.0
)

// review is one pass over the unseen parts of the page, held between two looks.
type review struct {
	phase string
	// held are the planned actions from the send on; end is the answer given instead when the run
	// said it was ready. One of them is set.
	held []Action
	end  *Step
	// origin is where the page was scrolled when the held actions were planned.
	origin  float64
	scrolls int
	// stuck counts scrolls that did not move the page; returns, scrolls back that missed.
	stuck, returns int
	// lastY is where the page was before the last scroll.
	lastY float64
}

func isReviewID(id string) bool { return strings.HasPrefix(id, reviewPrefix) }

// withoutReview drops the results of the review's own scrolls.
func withoutReview(results []ActionResult) []ActionResult {
	var out []ActionResult
	for _, result := range results {
		if !isReviewID(result.ID) {
			out = append(out, result)
		}
	}
	return out
}

// reviewOn is whether a review may begin: the decision model is there, the run has not used up
// its reviews, and some part of the page has not been seen.
func (a *Agent) reviewOn(s *session) bool {
	return a.checksOn(s) && s.reviews < a.cfg.MaxReviews && len(s.cover.gaps()) > 0
}

// recordReview writes a review look to the trace, and counts what the decision model cost.
func (a *Agent) recordReview(s *session, obs Observation, call modelCall, step Step) {
	s.usage.Checks++
	s.usage.CheckCost += call.Usage.Cost
	s.usage.Cost += call.Usage.Cost
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceReview, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
		Status: step.Status, Message: step.Message, Actions: step.Actions, Usage: s.usage,
	}
	var calls []modelCall
	if call.Kind != "" {
		calls = []modelCall{call}
	}
	a.record(s, entry, obs.Screenshot, calls)
}

// submitPoint asks the decision model which of the planned clicks, if any, sends the application.
// The points are drawn and numbered on the screenshot, since the model reads the picture and
// cannot be given coordinates. It reports the index of that action.
func (a *Agent) submitPoint(ctx context.Context, s *session, obs Observation, planned []Action) (int, bool) {
	criteria := map[string]string{pointNone: "none of the marked points sends the application"}
	for i, action := range planned {
		if action.X == nil || action.Y == nil {
			continue
		}
		switch action.Kind {
		case KindClick, KindDoubleClick:
			criteria[strconv.Itoa(i+1)] = "the control under marker " + strconv.Itoa(i+1)
		}
	}
	if len(criteria) == 1 {
		return 0, false
	}
	marked, err := markScreenshot(obs.Screenshot, planned)
	if err != nil {
		return 0, false
	}
	state := []decide.Part{
		decide.Text("A screenshot of a web page with numbered red markers where someone is about to click."),
		decide.Image("data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(marked)),
	}
	questions := map[string]decide.Question{askSubmitPoint: {
		Type: decide.TypeChoice,
		Instructions: "Which numbered marker, if any, is on the control that sends or submits the whole application: its final step? " +
			"A control that fills a field, opens a list, attaches a file, or goes to another section of the form does not send it.",
		Criteria: criteria,
	}}
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: state, Questions: questions})
	check := verdict{response: response, prompt: "which marked point sends the application"}
	call := check.call(err)
	a.recordReview(s, obs, call, Step{})
	if err != nil {
		slog.Warn("submit check failed", "session", s.id, "error", err)
		return 0, false
	}
	answer := response.Answers[askSubmitPoint]
	index, err := strconv.Atoi(answer.Choice)
	if err != nil || index < 1 || index > len(planned) || answer.Probabilities[answer.Choice] < a.cfg.SubmitPoint {
		return 0, false
	}
	return index - 1, true
}

// holdSubmit splits a plan at the click that sends the application when parts of the page are
// unseen: the actions before it go on, and the rest wait for the review.
func (a *Agent) holdSubmit(ctx context.Context, s *session, obs Observation, planned []Action) (before, held []Action) {
	if s.start.StopBeforeSubmit || len(planned) == 0 || !a.reviewOn(s) {
		return planned, nil
	}
	index, ok := a.submitPoint(ctx, s, obs, planned)
	if !ok {
		return planned, nil
	}
	return planned[:index], planned[index:]
}

// scrollStep is a step that scrolls the page by dy, from the middle of the screen.
func (a *Agent) scrollStep(s *session, obs Observation, r *review, dy float64, message string) Step {
	x, y := float64(obs.Viewport.Width)/2, float64(obs.Viewport.Height)/2
	r.scrolls++
	r.lastY = obs.Viewport.ScrollY
	s.stale, s.lastSig = 0, nil
	scroll := Action{ID: fmt.Sprintf("%s%d_%d", reviewPrefix, s.seq, r.scrolls), Kind: KindScroll, X: &x, Y: &y, DY: dy}
	return Step{Status: StatusWorking, Message: message, Actions: []Action{scroll}, Number: s.step, Usage: s.usage}
}

// reviewQuestion is asked of each screen the review looks at.
const reviewQuestion = "This is a screenshot of part of an application form. Is anything on it that would stop the form being sent: " +
	"a required field that is empty, or a message saying a field is required, invalid, or must be corrected? " +
	"A field that shows a value is filled in. Text that only explains the form is not a problem."

// reviewLook asks the decision model whether this screen holds a problem.
func (a *Agent) reviewLook(ctx context.Context, s *session, obs Observation) (bool, error) {
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{
		State:     checkState(obs.Screenshot),
		Questions: map[string]decide.Question{askReviewIssue: decide.YesNo(reviewQuestion)},
	})
	check := verdict{response: response, prompt: "anything that would stop the form being sent"}
	a.recordReview(s, obs, check.call(err), Step{Status: StatusWorking, Message: reviewMessage})
	if err != nil {
		return false, err
	}
	answer := response.Answers[askReviewIssue]
	if answer.Noul == nil {
		return false, fmt.Errorf("the checker gave no answer to %q", askReviewIssue)
	}
	return *answer.Noul >= a.cfg.ReviewIssue, nil
}

// handOff ends the review because something may stop the form: the driving model looks, with the
// page where the problem is, and plans again.
func (a *Agent) handOff(s *session, obs Observation, why string) {
	r := s.review
	s.review = nil
	s.reviews++
	s.plan, s.verify = nil, ""
	sent := "The actions you had planned from the send control on were not run."
	if r != nil && r.end != nil {
		sent = "You said the form was ready; it was not sent."
	}
	s.notes = append(s.notes, fmt.Sprintf("Before sending, Acorn looked through the parts of the page you had not seen. %s The page is scrolled there now (%.0f px from the top). Fix it, then continue. %s",
		why, obs.Viewport.ScrollY, sent))
}

// release ends a clean review: what was held goes out.
func (a *Agent) release(s *session, obs Observation) (Step, bool) {
	r := s.review
	s.review = nil
	s.reviews++
	s.stale, s.lastSig = 0, nil
	if r.end != nil {
		step := *r.end
		step.Usage = s.usage
		s.finished, s.stoppedFor = true, step.Message
		return step, true
	}
	actions, dropped := a.takePlan(s, r.held, nil)
	if len(actions) == 0 {
		return Step{}, false
	}
	return Step{Status: StatusWorking, Message: s.message, Actions: actions, Number: s.step, Usage: s.usage, Dropped: dropped}, true
}

// reviewStep carries the review one look on. It reports false when the driving model must look.
// results are the results of the actions the driving model sent (nil when called at the moment
// the review is planned).
func (a *Agent) reviewStep(ctx context.Context, s *session, obs Observation, results []ActionResult) (Step, bool) {
	r := s.review
	if r == nil {
		return Step{}, false
	}
	if r.phase == reviewWaiting {
		if len(s.plan) > 0 || s.verify != "" {
			return Step{}, false // the plan before the send is still running
		}
		if failed := failedResults(obs.Results); failed != "" {
			s.review = nil
			return Step{}, false
		}
		if results != nil {
			s.carried = results
		}
		r.phase = reviewSweeping
	}
	if r.phase == reviewSweeping {
		// The screen the review starts on was seen by the model; every later one is looked at here.
		if r.scrolls > 0 {
			issue, err := a.reviewLook(ctx, s, obs)
			if err != nil {
				slog.Warn("review check failed; the form goes on", "session", s.id, "error", err)
				s.checksOff = true
				return a.finishReview(s, obs)
			}
			if issue {
				a.handOff(s, obs, "Something there may stop it being sent: a required field that looks empty, or a message about a field.")
				return Step{}, false
			}
		}
		if moved := math.Abs(obs.Viewport.ScrollY - r.lastY); r.scrolls > 0 && moved < 8 {
			r.stuck++
		}
		gaps := s.cover.gaps()
		if len(gaps) > 0 && r.scrolls < maxReviewScrolls && r.stuck < 2 {
			maxY := math.Max(0, obs.Viewport.PageHeight-float64(obs.Viewport.Height))
			target := math.Min(maxY, math.Max(0, gaps[0].from-sweepOverlap))
			return a.scrollStep(s, obs, r, target-obs.Viewport.ScrollY, reviewMessage), true
		}
		return a.finishReview(s, obs)
	}
	// Returning: the page must be where the held actions were aimed.
	return a.returnStep(s, obs)
}

// finishReview scrolls back to where the held plan was made, or releases it where it is.
func (a *Agent) finishReview(s *session, obs Observation) (Step, bool) {
	r := s.review
	r.phase = reviewReturning
	return a.returnStep(s, obs)
}

func (a *Agent) returnStep(s *session, obs Observation) (Step, bool) {
	r := s.review
	if r.end != nil || math.Abs(obs.Viewport.ScrollY-r.origin) <= returnTolerance {
		return a.release(s, obs)
	}
	if r.returns >= maxReviewReturns {
		a.handOff(s, obs, "Nothing there stopped it, but the page could not be scrolled back to where your plan was made, so it was not sent.")
		return Step{}, false
	}
	r.returns++
	return a.scrollStep(s, obs, r, r.origin-obs.Viewport.ScrollY, reviewMessage), true
}
