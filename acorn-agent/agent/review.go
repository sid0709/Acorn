package agent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A fast-fill plan is carried out zone by zone, and when the last action of a zone is done the extension
// sends a photo of the page (shots.go). The agent reviews it while the next zone is being carried out: the
// decision model is asked, for each field the plan filled in that zone, whether the field shows what was
// typed into it. Nothing waits for the answer. When the plan's batch is over the answers are collected, and
// what is wrong is told to the model once, with the survey that follows, to put right in one answer.

const (
	// maxExpectChars bounds the value a review asks about.
	maxExpectChars = 120
	// reviewTimeout bounds one review of a zone.
	reviewTimeout = 20 * time.Second
	// reviewWait is the longest the next look waits for reviews that are still running; what has not come
	// back by then is picked up at the look after.
	reviewWait = 6 * time.Second
	// askExpectPrefix starts the key of the question about the n-th field of a zone: "e1", "e2", ...
	askExpectPrefix = "e"
)

// expectation is what a field of the plan should show once the plan has been carried out: the field is
// known by its label, as the model wrote it.
type expectation struct {
	Label string
	Value string
}

// reviewResult is the review of one zone.
type reviewResult struct {
	Zone   int
	Failed []expectation
	Call   modelCall
	Cost   float64
	Err    error
}

// reviewState is what a session keeps for the reviews running beside its plan.
type reviewState struct {
	mu   sync.Mutex
	wg   sync.WaitGroup
	done []reviewResult
	// started holds the zones of the plan being carried out that have a review (by plan and zone), so a
	// photo that comes twice (mid-batch and again with the look) is reviewed once.
	started map[string]bool
	// calls are the reviews as model calls, for the trace of the next entry.
	calls []modelCall
}

// expectationsOf is what the plan fills in, by zone: a field the plan clicked on (the point has a label)
// and typed into. A secret is not asked about, and neither is a dropdown: its answer is chosen by a script
// of its own and is not on the page yet when the zone's photo is taken.
func expectationsOf(planned []Action) map[int][]expectation {
	out := map[int][]expectation{}
	label := ""
	for _, action := range planned {
		switch {
		case isPointAction(action):
			label = strings.TrimSpace(action.Label)
		case action.Kind == KindType && !action.Secret && action.Zone > 0 && label != "" && strings.TrimSpace(action.Text) != "":
			out[action.Zone] = append(out[action.Zone], expectation{Label: label, Value: clipText(strings.TrimSpace(action.Text), maxExpectChars)})
			label = ""
		}
	}
	return out
}

// expectQuestion asks whether the field with a label shows a value.
func expectQuestion(label, value string) decide.Question {
	return decide.YesNo(fmt.Sprintf("Does the field labelled %q show %q as its value? A dropdown shows the option chosen. "+
		"Answer no if the field is empty, shows something else, or shows an error.", label, value))
}

func expectKey(n int) string { return fmt.Sprintf("%s%d", askExpectPrefix, n) }

// reviewsOn is whether the zones of this run are reviewed.
func (a *Agent) reviewsOn(s *session) bool {
	return s.start.FastFill && a.checksOn(s)
}

// startReview starts the review of a zone's photo on the side, unless it has one. The session is locked.
func (a *Agent) startReview(s *session, shot ZoneShot) {
	if !a.reviewsOn(s) {
		return
	}
	exps := s.expect[shot.Zone]
	key := fmt.Sprintf("%d/%d", s.planGen, shot.Zone)
	if len(exps) == 0 || s.reviews.started[key] {
		return
	}
	if s.reviews.started == nil {
		s.reviews.started = map[string]bool{}
	}
	s.reviews.started[key] = true
	s.reviews.wg.Add(1)
	go a.reviewZone(s, shot, exps)
}

// reviewZone asks the decision model about every field of a zone, in one call, and keeps the answer.
func (a *Agent) reviewZone(s *session, shot ZoneShot, exps []expectation) {
	defer s.reviews.wg.Done()
	ctx, cancel := context.WithTimeout(context.Background(), reviewTimeout)
	defer cancel()
	questions := map[string]decide.Question{}
	for i, exp := range exps {
		questions[expectKey(i+1)] = expectQuestion(exp.Label, exp.Value)
	}
	state := []decide.Part{
		decide.Text("A screenshot of part of an application form that has just been filled in."),
		decide.Image(shot.Screenshot),
	}
	started := time.Now()
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: state, Questions: questions})
	result := reviewResult{Zone: shot.Zone, Err: err, Cost: response.Usage.Cost}
	result.Call = verdict{response: response, prompt: fmt.Sprintf("what zone %d shows: %s", shot.Zone, expectLabels(exps))}.call(err)
	if result.Call.LatencyMs == 0 {
		result.Call.LatencyMs = time.Since(started).Milliseconds()
	}
	if err == nil {
		for i, exp := range exps {
			answer, ok := response.Answers[expectKey(i+1)]
			// A field more likely wrong than right is told to the model; there is no tunable cutoff.
			if ok && answer.Noul != nil && *answer.Noul < likely {
				result.Failed = append(result.Failed, exp)
			}
		}
	}
	s.reviews.mu.Lock()
	s.reviews.done = append(s.reviews.done, result)
	s.reviews.mu.Unlock()
}

// expectLabels lists the labels of some expectations, for the trace.
func expectLabels(exps []expectation) string {
	labels := make([]string, len(exps))
	for i, exp := range exps {
		labels[i] = fmt.Sprintf("%d %q", i+1, exp.Label)
	}
	return strings.Join(labels, ", ")
}

// reviewShots starts the review of the zone photos that came with a look, for the zones whose photo did
// not reach the agent mid-batch. The session is locked.
func (a *Agent) reviewShots(s *session) {
	for _, shot := range s.zones {
		a.startReview(s, shot)
	}
}

// collectReviews waits a little for the reviews still running, then takes every finished one: what they
// found wrong is told to the model, and the next look is a survey so it can put it right. The session is locked.
func (a *Agent) collectReviews(s *session) {
	if !waitGroup(&s.reviews.wg, reviewWait) {
		slog.Warn(runName(s.id) + ": a review of what was filled in is still running, so it is picked up at the next look.")
	}
	s.reviews.mu.Lock()
	done := s.reviews.done
	s.reviews.done = nil
	s.reviews.mu.Unlock()
	var wrong []string
	for _, result := range done {
		s.usage.Checks++
		s.usage.CheckCost += result.Cost
		s.usage.Cost += result.Cost
		s.reviews.calls = append(s.reviews.calls, result.Call)
		if result.Err != nil {
			slog.Warn(fmt.Sprintf("%s: could not review zone %d, so it is left to the survey that follows.", runName(s.id), result.Zone), plainlog.ErrorKey, result.Err)
			continue
		}
		for _, exp := range result.Failed {
			wrong = append(wrong, fmt.Sprintf("%q does not show %q (screen %d)", exp.Label, exp.Value, result.Zone))
		}
	}
	if len(wrong) == 0 {
		return
	}
	s.notes = append(s.notes, fmt.Sprintf("Acorn looked at each part of the page right after it was filled in and found %s: %s. "+
		"Put them right in one answer; the survey you are given shows the page as it is.",
		plainlog.Count(len(wrong), "field"), strings.Join(wrong, "; ")))
	s.surveyAgain = true
	slog.Warn(fmt.Sprintf("%s: the review of the filled-in fields found %s that do not show what was typed.", runName(s.id), plainlog.Count(len(wrong), "field")))
}

// takeReviewCalls is the reviews finished since the last entry, as model calls for its trace.
func (s *session) takeReviewCalls() []modelCall {
	calls := s.reviews.calls
	s.reviews.calls = nil
	return calls
}

// waitGroup waits for the group, at most d, and says whether it finished.
func waitGroup(wg *sync.WaitGroup, d time.Duration) bool {
	finished := make(chan struct{})
	go func() {
		wg.Wait()
		close(finished)
	}()
	select {
	case <-finished:
		return true
	case <-time.After(d):
		return false
	}
}
