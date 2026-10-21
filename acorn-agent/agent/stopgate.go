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
//   - When the model read fields as empty on its last survey, the decision model is asked which
//     of them only the applicant can fill. The stop is sent back with the rest named, as many times as a
//     pass fills some of them; a pass that filled none is the last, so a model that will not fill a field
//     does not go round for ever. A recorded run stopped for one identity number with six fields of the
//     step empty beside it.
//   - Otherwise the first stop of a run is sent back once, with a note, to go through the whole page and
//     do everything that does not need the applicant; a stop made while parts of the page are still unseen
//     is sent back too, up to Config.StopPasses times in a run.
//
// What is empty is the model's own reading of the pictures (fields.go), never what the page reports of its
// controls: when the model read every field it can fill as filled, the stop stands at once.

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

// commitState is the click that sends the page, as the plan kept it: the page it was on, and whether it
// went through.
type commitState struct {
	id   string
	url  string
	done bool
}

// fieldHold is a stop sent back for the required fields the page reported empty: the page it was on and
// the fields that were left to fill, so a pass that filled none of them is not sent back again.
type fieldHold struct {
	url  string
	left []string
}

// noteCommitPlanned remembers the click that sends the page when the plan keeps one.
func (s *session) noteCommitPlanned(planned []Action, obs Observation) {
	for _, action := range planned {
		if action.Commit != "" {
			s.commit = commitState{id: action.ID, url: withoutFragment(obs.URL)}
			return
		}
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

// askSendRefused is the key of the question whether the page refused the click that sent it.
const askSendRefused = "send_refused"

// noteRefusedSend says whether the page refused the click that sent it: the click went through, the look
// after it is on the same address, and the decision model reads on the screenshots that the form is still
// there with messages that answers are missing or wrong, not a confirmation or the next step of the form (a
// form that keeps one address goes on to its next step after a send). The model is told, with the fields it
// read as empty, and the next click that sends the page is held for one look (Agent.holdRefusedSend), so
// what the page asked for is set before it is sent again. A recorded run clicked an option the page showed
// as chosen and sent the page again at once, twice in two minutes, and the page refused the application
// as possible spam. What the page reports of its controls decides nothing: the pictures do.
func (a *Agent) noteRefusedSend(ctx context.Context, s *session, obs Observation) bool {
	if !s.commit.done || s.commit.url != withoutFragment(obs.URL) || !a.checksOn(s) {
		return false
	}
	// This send is judged once: the next plan's send is a new one.
	s.commit = commitState{}
	started := time.Now()
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: humanCheckState(obs), Questions: map[string]decide.Question{
		askSendRefused: decide.YesNo("The button that sends this form was just pressed. Does the page still show the same form, with messages " +
			"that some answers are missing or wrong (text beside fields, or a list of problems), rather than a confirmation, a new step of the " +
			"form with other questions, or a page that asks for something else?"),
	}})
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	call := verdict{response: response, prompt: "the page refused the send"}.call(err)
	if call.LatencyMs == 0 {
		call.LatencyMs = time.Since(started).Milliseconds()
	}
	s.reviews.calls = append(s.reviews.calls, call)
	if err != nil {
		slog.Warn(runName(s.id)+": could not read from the screen whether the page took the send, so the model judges it.", plainlog.ErrorKey, err)
		return false
	}
	answer, ok := response.Answers[askSendRefused]
	if !ok || answer.Noul == nil || *answer.Noul < likely {
		return false
	}
	left := s.emptyFieldsOn(obs.URL)
	s.sendRefused = true
	s.notes = append(s.notes, refusedSendNote(left))
	s.surveyAgain = true
	slog.Info(fmt.Sprintf("%s: the page refused the send (%.0f%% sure, from the screen); %s read as empty (%s); the next send is held for one look.",
		runName(s.id), *answer.Noul*100, plainlog.Count(len(left), "field"), quoted(left)))
	return true
}

// refusedSendNote tells the model that the page did not take the send, which fields it names, and how to
// set a field whose answer is on screen but not registered.
func refusedSendNote(left []string) string {
	named := "Read on the survey which answers the page says are missing or wrong."
	if len(left) > 0 {
		named = fmt.Sprintf("You read these fields as empty: %s. Read on the survey which answers the page says are missing or wrong.", quoted(left))
	}
	return "The page did not accept the click that sends it: it still shows the form, with messages about its answers. " + named + " " +
		"An answer that looks chosen on the screen may not be registered by the page. Set each such field again: for a choice, " +
		"open its list and click the option you want; for a box, click it, clear it and enter the value again. A message beside a field that " +
		"already shows the right answer may be left from the last send: do not change that field, it clears when the page is sent again. " +
		"Plan only those fields on this look. The click that sends the page is held until your next look, when you have seen the fields set."
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

// nothingLeftToFill is whether the model's own reading of the page says so: it listed the page's fields
// on a survey (fields.go) and none is empty. A field only the applicant can give is theirs, not the run's,
// and does not count. Before the model has read the page the stop is sent back as before.
func (s *session) nothingLeftToFill(obs Observation) bool {
	return len(s.fieldsOn(obs.URL)) > 0 && len(s.emptyFieldsOn(obs.URL)) == 0
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
		slog.Info(runName(s.id) + ": the stop stands at once: the model read nothing left on the page that the run can fill.")
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

// holdForFields sends a stop back while the model read fields as empty on its last survey (fields.go) that
// the decision model judges the run's to fill rather than the applicant's, naming them in the note; and
// not again once a pass filled none of them. Nothing is asked when no field was read as empty, or no
// decision model checks the run.
func (a *Agent) holdForFields(ctx context.Context, s *session, stop *StopInfo, reason string, obs Observation) (string, bool, []modelCall) {
	names := s.emptyFieldsOn(obs.URL)
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
		slog.Warn(fmt.Sprintf("%s: the stop stands: the last pass filled none of the %s read as empty (%s).",
			runName(s.id), plainlog.Count(len(left), "field"), quoted(left)))
		return "", false, calls
	}
	s.fieldHold = fieldHold{url: url, left: left}
	slog.Info(fmt.Sprintf("%s: the stop is sent back: %s read as empty that the run can fill (%s).",
		runName(s.id), plainlog.Count(len(left), "field"), quoted(left)))
	return fieldHoldNote(reason, left, own), true, calls
}

// personFieldKey is the question key of the n-th (from 1) field named to the decision model.
func personFieldKey(n int) string { return fmt.Sprintf("%s%d", askPersonFieldPrefix, n) }

// askPersonFields asks the decision model, for each field read as empty, whether only the
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
			"The problem it reports: %s What it asks the applicant to do: %s These fields of the page are still empty: %s.",
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

// fieldHoldNote tells the model which fields it read as empty, and that the
// applicant's own part waits until those are filled.
func fieldHoldNote(reason string, left, own []string) string {
	after := "what needs them"
	if len(own) > 0 {
		after = quoted(own)
	}
	return fmt.Sprintf("You asked to stop for the applicant (%s), but you read these fields as still empty: %s. "+
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
