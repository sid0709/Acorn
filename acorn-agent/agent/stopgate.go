package agent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// The applicant is asked last. A model that stops for them (a CAPTCHA, a code, a document, an identity
// number) has often done so with fillable fields still empty: the optional ones the profile answers, a
// part of the page it never scrolled to, or the rest of the step it stopped on. So a stop is not accepted
// at once:
//
//   - When the page reports required fields empty (or marked invalid), the decision model is asked which
//     of them only the applicant can fill. The stop is sent back with the rest named, as many times as a
//     pass fills some of them; a pass that filled none is the last, so a model that will not fill a field
//     does not go round for ever. A recorded run stopped for one identity number with six fields of the
//     step empty beside it.
//   - Otherwise the first stop of a run is sent back once, with a note, to go through the whole page and
//     do everything that does not need the applicant; a stop made while parts of the page are still unseen
//     is sent back too, up to Config.StopPasses times in a run.
//
// The page itself can say that nothing is left: it reports which of its controls are empty and which it
// marked invalid. When none is invalid and every empty control appeared after the click that sent the
// page went through (the boxes of a code, a check that the applicant is a person), the stop stands at
// once: what is empty is the applicant's part, and the page accepted the rest before it asked. A send
// that led on to the next page of a form (most of the fields it had are gone, though the URL may be the
// same) is not that: what the next page asks is the run's to fill.

// A stop for a human check is read against the screen. A recorded run stopped with reason captcha for
// the small badge that says a page is protected by such a service, with every field filled and the
// button that sends the page never pressed: the applicant was asked to pass a check that was not there,
// and the application was not sent. So on a captcha stop the decision model is asked, of the screenshot
// (and of the survey's screens, when the look has them), whether a check the applicant must pass by hand
// is in view: a box to tick, a puzzle, a challenge over the page. Below Config.CaptchaConfirm the stop is
// sent back once in a run, with a note to press the button that sends the page and to stop only when a
// check then stands in the way. The next such stop stands: a model that will not press the button does
// not go round for ever. No service is named anywhere: the checker judges what it sees.

// askHumanCheck is the key of the question whether the screen shows a check the applicant must pass.
const askHumanCheck = "human_check"

// stopPassMessage is what the person sees while the agent finishes before asking them.
const stopPassMessage = "Finishing everything else on the page before asking you."

// stopPassWait is how long the agent waits before the model looks again, as the page may still be moving.
const stopPassWaitMs = 300

// askPersonFieldPrefix starts the key of the question about a numbered empty field: "f1", "f2", ...
const askPersonFieldPrefix = "f"

// commitState is the click that sends the page, as the plan kept it: which controls the page had when it
// was planned, and whether it went through.
type commitState struct {
	id       string
	url      string
	controls map[string]bool
	// fields are the controls of those that are filled rather than pressed: a send that leads on to the
	// next page of a form leaves few of them.
	fields map[string]bool
	done   bool
}

// fieldHold is a stop sent back for the required fields the page reported empty: the page it was on and
// the fields that were left to fill, so a pass that filled none of them is not sent back again.
type fieldHold struct {
	url  string
	left []string
}

// noteCommitPlanned remembers the click that sends the page when the plan keeps one, and which controls
// the page had then: a control that appears once that click went through is the applicant's to fill.
func (s *session) noteCommitPlanned(planned []Action, obs Observation) {
	for _, action := range planned {
		if action.Commit == "" {
			continue
		}
		controls := make(map[string]bool, len(obs.Marks))
		fields := map[string]bool{}
		for _, mark := range obs.Marks {
			controls[mark.ID] = true
			if isField(mark.Kind) {
				fields[mark.ID] = true
			}
		}
		s.commit = commitState{id: action.ID, url: withoutFragment(obs.URL), controls: controls, fields: fields}
		return
	}
}

// noteCommitResults records that the click that sends the page went through, when its result came.
func (s *session) noteCommitResults(results []ActionResult) {
	if s.commit.id == "" || s.commit.done {
		return
	}
	for _, result := range results {
		if result.ID == s.commit.id && result.OK {
			s.commit.done = true
		}
	}
}

// noteRefusedSend says whether the page refused the click that sent it: the click went through, the look
// after it is the same page, and the page reports required fields empty or marked invalid. The model is
// told which, and how to set them so the page registers them, and the next click that sends the page is
// held for one look (Agent.holdRefusedSend), so what the page reported is set before it is sent again. A
// recorded run clicked an option the page showed as chosen and sent the page again at once, twice in two
// minutes, and the page refused the application as possible spam.
func (s *session) noteRefusedSend(obs Observation) bool {
	if !s.commit.done || s.commit.url != withoutFragment(obs.URL) || !s.commit.samePage(obs.Marks) {
		return false
	}
	left := unfilledFields(obs.Marks)
	if len(left) == 0 {
		return false
	}
	// This send is judged once: the next plan's send is a new one.
	s.commit = commitState{}
	s.sendRefused = true
	s.notes = append(s.notes, refusedSendNote(left))
	s.surveyAgain = true
	slog.Info(fmt.Sprintf("%s: the page refused the send: it reports %s empty or invalid (%s); the next send is held for one look.",
		runName(s.id), plainlog.Count(len(left), "required field"), quoted(left)))
	return true
}

// refusedSendNote tells the model that the page did not take the send, which fields it names, and how to
// set a field whose answer is on screen but not registered.
func refusedSendNote(left []string) string {
	return fmt.Sprintf("The page did not accept the click that sends it: it reports these required fields empty or invalid: %s. "+
		"An answer that looks chosen on the screen may not be registered by the page. Set each field named again: for a choice, "+
		"pick a different option first and then the one you want; for a box, click it, clear it and enter the value again. "+
		"Plan only those fields on this look. The click that sends the page is held until your next look, when you have seen the fields set.", quoted(left))
}

// holdRefusedSend takes the click that sends the page out of the first plan after the page refused one, so
// the fields the page named are set and seen set before the page is sent again. It reports whether one was
// held, and says so in dropped for the log.
func (a *Agent) holdRefusedSend(s *session, planned *[]Action, dropped *[]string) bool {
	if !s.sendRefused {
		return false
	}
	s.sendRefused = false
	kept, held := withoutSend(*planned)
	if len(held) == 0 {
		return false
	}
	*planned = kept
	*dropped = append(*dropped, fmt.Sprintf("the click that sends the page was held back (%s with it): the page refused the last send, and the fields it named are set first",
		plainlog.Count(len(held)-1, "later action")))
	s.surveyAgain = true
	slog.Info(fmt.Sprintf("%s: the click that sends the page was held back: the page refused the last send.", runName(s.id)))
	return true
}

// samePage is whether the page still holds at least half of the fields it had when it was sent. A send
// that leads on to the next page of a form that keeps one URL (a wizard) leaves few or none of them, and
// what that page asks is the run's to fill, not the applicant's; a page that asks for a code after the
// send keeps them. A page sent with no fields on it says nothing, and is taken to be the same page.
func (c commitState) samePage(marks []ControlMark) bool {
	if len(c.fields) == 0 {
		return true
	}
	kept := 0
	for _, mark := range marks {
		if c.fields[mark.ID] {
			kept++
		}
	}
	return kept*2 >= len(c.fields)
}

// nothingLeftToFill is whether the page says so: no control is marked invalid, and every control it
// reports empty appeared after the click that sent the page went through on this page, which is still
// that page. A look that does not report the page's controls says nothing, and the stop is sent back as before.
func (s *session) nothingLeftToFill(obs Observation) bool {
	if len(obs.Marks) == 0 {
		return false
	}
	sent := s.commit.done && s.commit.url == withoutFragment(obs.URL) && s.commit.samePage(obs.Marks)
	for _, mark := range obs.Marks {
		if mark.Invalid {
			return false
		}
		if mark.Empty == nil || !*mark.Empty {
			continue
		}
		if !sent || s.commit.controls[mark.ID] {
			return false
		}
	}
	return true
}

// unfilledFields are the controls the page reports required and empty, or marked invalid, that are
// filled rather than pressed, named as the model would name them: a text box by its label, a group of
// radio buttons once, by the question it answers (else by its choices). A control the page gives no
// name is left out: it cannot be told to the model.
func unfilledFields(marks []ControlMark) []string {
	var names []string
	seen := map[string]bool{}
	choices := map[string][]string{}
	for _, mark := range marks {
		if !isField(mark.Kind) || !(mark.Invalid || (mark.Required && mark.Empty != nil && *mark.Empty)) {
			continue
		}
		if mark.Group == "" {
			if label := strings.TrimSpace(mark.Label); label != "" && !seen[mark.ID] {
				seen[mark.ID] = true
				names = append(names, label)
			}
			continue
		}
		if label := strings.TrimSpace(mark.Label); label != "" {
			choices[mark.Group] = append(choices[mark.Group], label)
		}
		if seen[mark.Group] {
			continue
		}
		seen[mark.Group] = true
		if question := strings.TrimSpace(mark.Question); question != "" {
			names = append(names, question)
		} else {
			names = append(names, "the choice between "+quotedChoices(choices, mark.Group, marks))
		}
	}
	return names
}

// quotedChoices names a group of radio buttons that has no question by its choices, in the page's order.
func quotedChoices(choices map[string][]string, group string, marks []ControlMark) string {
	var labels []string
	for _, mark := range marks {
		if mark.Group == group {
			if label := strings.TrimSpace(mark.Label); label != "" {
				labels = append(labels, label)
			}
		}
	}
	if len(labels) == 0 {
		labels = choices[group]
	}
	return quoted(labels)
}

// quoted lists names in quotes.
func quoted(names []string) string {
	parts := make([]string, len(names))
	for i, name := range names {
		parts[i] = fmt.Sprintf("%q", name)
	}
	return strings.Join(parts, ", ")
}

// humanCheckQuestion asks whether the screen shows a check the applicant must pass by hand.
func humanCheckQuestion() map[string]decide.Question {
	return map[string]decide.Question{askHumanCheck: decide.YesNo(
		"Does this screen show a check that the applicant must pass by hand before the page goes on: a box to tick to prove they are a person, " +
			"a picture or puzzle challenge, or a challenge dialog over the page? Answer no for a small badge, logo or notice, usually in a corner, " +
			"saying the page is protected by such a service, and for a form that shows only its fields and the button that sends it.")}
}

// humanCheckState is what the checker sees: the screenshot, or every screen of the survey when the look is
// one, so a check anywhere on the page counts.
func humanCheckState(obs Observation) []decide.Part {
	if len(obs.Survey) == 0 {
		return checkState(obs.Screenshot)
	}
	parts := []decide.Part{decide.Text("Screenshots of a web page the applicant's browser is on, from its top to its bottom.")}
	for _, screen := range obs.Survey {
		parts = append(parts, decide.Image(screen.Screenshot))
	}
	return parts
}

// humanCheckOnScreen asks the decision model whether the screen shows a check the applicant must pass by
// hand. It reports how sure it is, the call for the trace, and whether an answer came: a checker that
// cannot answer leaves the model's word standing.
func (a *Agent) humanCheckOnScreen(ctx context.Context, s *session, obs Observation) (float64, modelCall, bool) {
	started := time.Now()
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: humanCheckState(obs), Questions: humanCheckQuestion()})
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	call := verdict{response: response, prompt: "a check the applicant must pass by hand is on screen"}.call(err)
	if call.LatencyMs == 0 {
		call.LatencyMs = time.Since(started).Milliseconds()
	}
	if err != nil {
		slog.Warn(runName(s.id)+": could not read from the screen whether a human check is there, so the model's word stands.", plainlog.ErrorKey, err)
		return 0, call, false
	}
	answer, ok := response.Answers[askHumanCheck]
	if !ok || answer.Noul == nil {
		slog.Warn(runName(s.id) + ": the checker gave no answer about a human check, so the model's word stands.")
		return 0, call, false
	}
	return *answer.Noul, call, true
}

// captchaHoldNote tells the model that the screen shows no check to pass, and to press the button that
// sends the page before it stops for one.
func captchaHoldNote(sure float64) string {
	return fmt.Sprintf("You asked to stop for a human check (captcha), but a checker read the screen and is only %.0f%% sure there is one for the applicant to pass. "+
		"A badge, logo or notice saying the page is protected is not a check: nothing on it needs their hand. "+
		"Go on: press the button that sends the application (or goes on to the next page). "+
		"Stop with need_person for the check only when the page then shows one to tick or solve, or will not go on until it is passed.", sure*100)
}

// holdStop says whether this stop is sent back, with the note that tells the model why, and the decision
// calls made to judge it, if any were.
func (a *Agent) holdStop(ctx context.Context, s *session, status string, answer reply, obs Observation) (string, bool, []modelCall) {
	if a.cfg.StopPasses <= 0 || (status != StatusNeedPerson && status != StatusStuck) {
		return "", false, nil
	}
	// A job that cannot be applied to has nothing on its page for the run to finish: the stop ends the run
	// at once, so a queue of jobs goes on to the next (sendgate.go says how the model is told to judge it).
	if answer.Stop != nil && strings.TrimSpace(answer.Stop.Reason) == StopJobUnavailable {
		slog.Info(runName(s.id) + ": the stop stands at once: the model reports the job cannot be applied to online.")
		return "", false, nil
	}
	if s.nothingLeftToFill(obs) {
		slog.Info(runName(s.id) + ": the stop stands at once: the page reports nothing left to fill but what appeared after it was sent.")
		return "", false, nil
	}
	reason := ""
	if answer.Stop != nil {
		reason = strings.TrimSpace(answer.Stop.Reason)
	}
	note, held, calls := a.holdForFields(ctx, s, answer.Stop, reason, obs)
	if held {
		s.stopPasses++
		return note, true, calls
	}
	// A stop for a human check the screen does not show is sent back once, to press the button that sends the page.
	if reason == StopCaptcha && s.captchaPasses == 0 && a.cfg.CaptchaConfirm > 0 && a.checksOn(s) {
		sure, call, answered := a.humanCheckOnScreen(ctx, s, obs)
		calls = append(calls, call)
		if answered && sure < a.cfg.CaptchaConfirm {
			s.captchaPasses++
			s.stopPasses++
			slog.Info(fmt.Sprintf("%s: the stop is sent back: the checker is only %.0f%% sure the screen shows a human check to pass.", runName(s.id), sure*100))
			return captchaHoldNote(sure), true, calls
		}
	}
	if s.stopPasses >= a.cfg.StopPasses {
		return "", false, calls
	}
	// The first stop always goes back once; later ones only while some of the page has not been seen.
	if s.stopPasses > 0 && len(s.cover.gaps()) == 0 {
		return "", false, calls
	}
	s.stopPasses++
	return fmt.Sprintf("You asked to stop for the applicant (%s), but the applicant is asked last. Before anyone is asked, go through the whole page from its top: fill every field you can from the applicant's details, optional ones too wherever those details answer them, and do every other action that does not need the applicant. The note under the screenshot says which parts of the page you have not looked at; look at them. Say in your observation what you checked. Report need_person again only when nothing fillable is left.", orOther(reason)), true, calls
}

// holdForFields sends a stop back while the page reports required fields empty, or marked invalid, that
// the decision model judges the run's to fill rather than the applicant's, naming them in the note; and
// not again once a pass filled none of them. Nothing is asked when the page reports no such field, or no
// decision model checks the run.
func (a *Agent) holdForFields(ctx context.Context, s *session, stop *StopInfo, reason string, obs Observation) (string, bool, []modelCall) {
	names := unfilledFields(obs.Marks)
	if len(names) == 0 || !a.checksOn(s) {
		return "", false, nil
	}
	theirs, call, err := a.askPersonFields(ctx, s, stop, names)
	s.usage.Checks++
	s.usage.CheckCost += call.Usage.Cost
	s.usage.Cost += call.Usage.Cost
	calls := []modelCall{call}
	if err != nil {
		slog.Warn(runName(s.id)+": could not ask which of the empty fields are the applicant's, so the stop is judged without them.", plainlog.ErrorKey, err)
		return "", false, calls
	}
	var left, own []string
	for _, name := range names {
		if theirs[name] >= a.cfg.PersonField {
			own = append(own, name)
		} else {
			left = append(left, name)
		}
	}
	if len(left) == 0 {
		return "", false, calls
	}
	url := withoutFragment(obs.URL)
	if s.fieldHold.url == url && len(left) >= len(s.fieldHold.left) {
		slog.Warn(fmt.Sprintf("%s: the stop stands: the last pass filled none of the %s the page reports empty (%s).",
			runName(s.id), plainlog.Count(len(left), "required field"), quoted(left)))
		return "", false, calls
	}
	s.fieldHold = fieldHold{url: url, left: left}
	slog.Info(fmt.Sprintf("%s: the stop is sent back: the page reports %s empty that the run can fill (%s).",
		runName(s.id), plainlog.Count(len(left), "required field"), quoted(left)))
	return fieldHoldNote(reason, left, own), true, calls
}

// personFieldKey is the question key of the n-th (from 1) field named to the decision model.
func personFieldKey(n int) string { return fmt.Sprintf("%s%d", askPersonFieldPrefix, n) }

// askPersonFields asks the decision model, for each field the page reports empty, whether only the
// applicant can fill it: the thing the model stops for, or of the same kind. It answers with the
// probability for each name.
func (a *Agent) askPersonFields(ctx context.Context, s *session, stop *StopInfo, names []string) (map[string]float64, modelCall, error) {
	started := time.Now()
	problem, todo := "", ""
	if stop != nil {
		problem, todo = strings.TrimSpace(stop.Problem), strings.TrimSpace(stop.Action)
	}
	listed := make([]string, len(names))
	questions := map[string]decide.Question{}
	for i, name := range names {
		listed[i] = fmt.Sprintf("%d %q", i+1, name)
		questions[personFieldKey(i+1)] = decide.YesNo(fmt.Sprintf(
			"Can only the applicant fill field %d, %q, by hand: is it what the helper stops for, or of the same kind "+
				"(an identity or account number only they know, a code sent to them, a document only they have, a check that they are a person)? "+
				"Answer no if the applicant's details, or the answer most applicants give, can fill it: a name, a demographic question, "+
				"a yes or no about their situation, a number of years, a choice from a list.", i+1, name))
	}
	state := []decide.Part{decide.Text(fmt.Sprintf(
		"A helper is filling in a job application for an applicant, and wants to stop and ask the applicant to act. "+
			"The problem it reports: %s What it asks the applicant to do: %s The page still reports these required fields empty: %s.",
		orNone(problem), orNone(todo), strings.Join(listed, "; ")))}
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: state, Questions: questions})
	call := verdict{response: response, prompt: "fields only the applicant can fill: " + strings.Join(listed, ", ")}.call(err)
	if call.LatencyMs == 0 {
		call.LatencyMs = time.Since(started).Milliseconds()
	}
	if err != nil {
		return nil, call, err
	}
	out := map[string]float64{}
	for i, name := range names {
		if answer, ok := response.Answers[personFieldKey(i+1)]; ok && answer.Noul != nil {
			out[name] = *answer.Noul
		}
	}
	return out, call, nil
}

// fieldHoldNote tells the model which required fields the page still reports empty, and that the
// applicant's own part waits until those are filled.
func fieldHoldNote(reason string, left, own []string) string {
	after := "what needs them"
	if len(own) > 0 {
		after = quoted(own)
	}
	return fmt.Sprintf("You asked to stop for the applicant (%s), but the page still reports these required fields empty: %s. "+
		"Fill each of them now from the applicant's details, with the answer most applicants give where the details say nothing, "+
		"and do every other action that does not need the applicant, all in one plan; the applicant will do %s after. "+
		"Report need_person again only when nothing fillable is left.", orOther(reason), quoted(left), after)
}

func orOther(reason string) string {
	if reason == "" {
		return "no reason given"
	}
	return reason
}
