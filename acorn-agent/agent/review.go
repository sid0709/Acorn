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
// typed into it. Nothing waits for the answer. A finished review is taken into the run's to-do list at once
// when the extension is waiting for that list (WaitFields, fields.go), so the sidebar follows each zone
// within about a second of its photo; the rest are taken in when the plan's batch is over. What is wrong is
// told to the model once, with the survey that follows, to put right in one answer.

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
// known by its label, as the model wrote it. Pick is that the value is chosen in a dropdown: the photo that
// shows it is set in the same pass as the zone's typing, so the zone's photo shows both.
type expectation struct {
	Label string
	Value string
	Pick  bool
	// Chosen is the option the probe clicked for a dropdown, in the page's own words when it named its
	// options (probe.go): the review then asks for what the page shows, not for the model's wording of it.
	Chosen string
	// Y is where the plan's point for the field lies on the page (screenshot pixels from its top).
	Y float64
}

// reviewResult is the review of one zone.
type reviewResult struct {
	Zone int
	// PlanGen is the plan whose zone it reviewed.
	PlanGen int
	// Asked are the fields the review asked about, and Failed those it found not showing what was planned.
	Asked  []expectation
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
	// started holds the zones of the plan being carried out that have a review (by plan and zone), so a photo
	// that comes twice (mid-batch and again with the look) is reviewed once.
	started map[string]bool
	// calls are the reviews as model calls, for the trace of the next entry.
	calls []modelCall
	// ready is closed (and dropped) when a review ends, so a wait for the to-do list takes it in at once.
	ready chan struct{}
	// wrong is what the reviews taken in since the last look found not showing what was planned, for the
	// note of that look.
	wrong []string
}

// finished keeps a review that ended and wakes a wait for the to-do list (WaitFields, fields.go).
func (r *reviewState) finished(result reviewResult) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.done = append(r.done, result)
	if r.ready != nil {
		close(r.ready)
		r.ready = nil
	}
}

// waking is a channel closed when the next review ends.
func (r *reviewState) waking() <-chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ready == nil {
		r.ready = make(chan struct{})
	}
	return r.ready
}

// take is the reviews that ended since the last take.
func (r *reviewState) take() []reviewResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	done := r.done
	r.done = nil
	return done
}

// expectationsOf is what the plan fills in, by zone: a field the plan clicked on (the point has a label)
// and typed into, and a dropdown it chose in. A secret is not asked about. A field the plan fills more than
// once is asked about for the last value only: that is what it should show.
func expectationsOf(planned []Action, obs Observation) map[int][]expectation {
	out := map[int][]expectation{}
	put := func(zone int, exp expectation) {
		for i, had := range out[zone] {
			if labelsAgree(had.Label, exp.Label) {
				out[zone][i] = exp
				return
			}
		}
		out[zone] = append(out[zone], exp)
	}
	label, y := "", 0.0
	for _, action := range planned {
		switch {
		case action.Kind == KindChoose && action.Zone > 0 && strings.TrimSpace(action.Label) != "" && strings.TrimSpace(action.Text) != "":
			put(action.Zone, expectation{Label: strings.TrimSpace(action.Label), Value: clipText(strings.TrimSpace(action.Text), maxExpectChars), Pick: true, Y: pageY(action, obs)})
			label = ""
		case isPointAction(action):
			label, y = strings.TrimSpace(action.Label), pageY(action, obs)
		case action.Kind == KindType && !action.Secret && action.Zone > 0 && label != "" && strings.TrimSpace(action.Text) != "":
			put(action.Zone, expectation{Label: label, Value: clipText(strings.TrimSpace(action.Text), maxExpectChars), Y: y})
			label = ""
		}
	}
	return out
}

// expectQuestion asks whether the field with a label shows the planned answer. The answer is matched by
// what it means, not letter for letter: a dropdown shows the option chosen, and the page's wording of it
// may be longer than or differ from the model's ("No, never" for "No"; "Company careers page" for
// "Careers page"). A review that asked for the letters sent two correct picks back to the model as wrong
// in one recorded run, and the model set them again. When the option clicked is known in the page's own
// words (Chosen), that is what is asked for.
func expectQuestion(exp expectation) decide.Question {
	asked := fmt.Sprintf("Does the field labelled %q show an answer that means %q?", exp.Label, exp.Value)
	if chosen := strings.TrimSpace(exp.Chosen); chosen != "" && !strings.EqualFold(chosen, strings.TrimSpace(exp.Value)) {
		asked = fmt.Sprintf("Does the field labelled %q show the option %q (chosen as the answer %q)?", exp.Label, chosen, exp.Value)
	}
	return decide.YesNo(asked + " A dropdown shows the option chosen, and its wording may be longer than or differ from the answer " +
		"as long as it says the same thing; a box that takes several choices shows each as a tag, and the one asked about among them is enough. " +
		"A field whose answer is not settled does not show it: a list of suggestions or options still open under or over the field, a highlighted suggestion " +
		"waiting to be chosen, or a sign that the field is still loading or searching means no choice has been made yet, whatever text sits in the box. " +
		"Answer no if the field is empty, shows a different answer, is not settled, or shows an error.")
}

func expectKey(n int) string { return fmt.Sprintf("%s%d", askExpectPrefix, n) }

// reviewsOn is whether the zones of this run are reviewed.
func (a *Agent) reviewsOn(s *session) bool {
	return s.start.FastFill && a.checksOn(s)
}

// startReview starts the review of a zone's photo on the side, unless it has one: the fields typed into and
// the dropdowns set in that zone, which are set in the same pass (probe.go), so its photo shows both. The
// session is locked.
func (a *Agent) startReview(s *session, shot ZoneShot) {
	if !a.reviewsOn(s) {
		return
	}
	key := fmt.Sprintf("%d/%d", s.planGen, shot.Zone)
	exps := s.expect[shot.Zone]
	if len(exps) == 0 || s.reviews.started[key] {
		return
	}
	if s.reviews.started == nil {
		s.reviews.started = map[string]bool{}
	}
	s.reviews.started[key] = true
	s.reviews.wg.Add(1)
	go a.reviewZone(s, shot, exps, s.planGen)
}

// reviewZone asks the decision model about every field of a zone, in one call, and keeps the answer.
func (a *Agent) reviewZone(s *session, shot ZoneShot, exps []expectation, planGen int) {
	defer s.reviews.wg.Done()
	ctx, cancel := context.WithTimeout(context.Background(), reviewTimeout)
	defer cancel()
	questions := map[string]decide.Question{}
	for i, exp := range exps {
		questions[expectKey(i+1)] = expectQuestion(exp)
	}
	state := []decide.Part{
		decide.Text("A screenshot of part of an application form that has just been filled in."),
		decide.Image(shot.Screenshot),
	}
	started := time.Now()
	response, err := a.newScreen(s.keys()).Decide(ctx, decide.Request{State: state, Questions: questions})
	result := reviewResult{Zone: shot.Zone, PlanGen: planGen, Asked: exps, Err: err, Cost: response.Usage.Cost}
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
	s.reviews.finished(result)
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

// applyReview takes one finished review into the run: its usage and trace call, the zone's standing, and the
// to-do list, where a field found not showing what was planned goes back to empty and the rest are ticked
// off and settle their rows. What it found wrong is kept for the note of the next look. The session is locked.
func (s *session) applyReview(result reviewResult) {
	s.usage.Checks++
	s.usage.CheckCost += result.Cost
	s.usage.Cost += result.Cost
	s.reviews.calls = append(s.reviews.calls, result.Call)
	if result.PlanGen == s.planGen {
		s.reviewed[result.Zone] = result.Err == nil && len(result.Failed) == 0
	}
	if result.Err != nil {
		slog.Warn(fmt.Sprintf("%s: could not review zone %d, so it is left to the survey that follows.", runName(s.id), result.Zone), plainlog.ErrorKey, result.Err)
		return
	}
	for _, exp := range result.Failed {
		s.reviews.wrong = append(s.reviews.wrong, fmt.Sprintf("%q does not show %q (screen %d)", exp.Label, exp.Value, result.Zone))
		s.setField(exp.Label, FieldEmpty)
		s.unverified(exp.Label, exp.Y)
	}
	// What the zone's review did not fault, it confirmed: those fields are ticked off the to-do list
	// (fields.go) and settle their rows (settled.go).
	for _, exp := range result.Asked {
		failed := false
		for _, bad := range result.Failed {
			failed = failed || bad.Label == exp.Label
		}
		if !failed {
			// A review that comes back after the run left the page confirms nothing on the page it is on now.
			if s.expectURL == s.confirmedURL {
				s.confirmed = append(s.confirmed, exp.Label)
			}
			s.setField(exp.Label, FieldFilled)
		}
	}
}

// collectReviews waits a little for the reviews still running, then takes in every finished one that a wait
// for the to-do list did not take in already: what they found wrong is told to the model, and the next look
// is a survey so it can put it right. The session is locked.
func (a *Agent) collectReviews(s *session) {
	if !waitGroup(&s.reviews.wg, reviewWait) {
		slog.Warn(runName(s.id) + ": a review of what was filled in is still running, so it is picked up at the next look.")
	}
	for _, result := range s.reviews.take() {
		s.applyReview(result)
	}
	wrong := s.reviews.wrong
	s.reviews.wrong = nil
	if len(wrong) == 0 {
		return
	}
	s.notes = append(s.notes, fmt.Sprintf("Acorn looked at each part of the page right after it was filled in and found %s: %s. "+
		"Put them right in one answer; the screenshots you are given show the page as it is.",
		plainlog.Count(len(wrong), "field"), strings.Join(wrong, "; ")))
	s.surveyAgain = true
	slog.Warn(fmt.Sprintf("%s: the review of the filled-in fields found %s that do not show what was typed.", runName(s.id), plainlog.Count(len(wrong), "field")))
}

// noteChosen keeps the page's own words for the option the probe clicked for a dropdown of the plan, so the
// review of its zone asks for what the page shows, not for the model's wording of the answer. The session is
// locked.
func (s *session) noteChosen(choose Action, option string) {
	option = strings.TrimSpace(option)
	label := strings.TrimSpace(choose.Label)
	if option == "" || label == "" {
		return
	}
	for i := range s.expect[choose.Zone] {
		if labelsAgree(s.expect[choose.Zone][i].Label, label) {
			s.expect[choose.Zone][i].Chosen = clipText(option, maxExpectChars)
		}
	}
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
