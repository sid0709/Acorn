package agent

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-agent/decide"
)

// A dropdown the page draws itself hides its options until it is opened, and the driving model
// only sees them on its next look: one call (about 7 s) per dropdown, and a click aimed at an
// option can land on the wrong one when the list moves. So the driving model says only what each
// dropdown should be set to (a "choose" action: the control's point and the answer in words), and
// the agent does the rest with the decision model, which reads a screenshot in a second or two:
// open the control, check that a list did open (a click can miss the control: it is moved onto the
// box and tried again, and nothing is ever typed into a list that is not open, since typed spaces
// scroll the page), type the answer to narrow the list (a model counts three options reliably and ten
// not: it chose the 7th of 8 for the 6th), look at the narrowed list, ask which option, counting from
// the first, answers it, and press Home, ArrowDown to it and Enter. Typed words that match no option
// are taken back out and the whole list is looked at once. The extension only ever receives a
// click, some typing and keys.
//
// Several dropdowns in one plan are set from the bottom of the screen up: a choice can add or
// remove a message under its control, which moves everything below it but nothing above.

const (
	// askOption is the decision model's question about an open list.
	askOption = "option"
	// askListOpen is its question of whether a list is open at all: a click that missed the
	// control opens nothing, and typing then would go nowhere.
	askListOpen = "list_open"
	// listOpenMatch is how sure the decision model must be that a list is open.
	listOpenMatch = 0.5
	// optionNone is its answer when no option answers.
	optionNone = "none"
	// maxOptionPosition is how far down an open list the decision model counts.
	maxOptionPosition = 12
	// maxClearKeys bounds the backspaces that clear what was typed to narrow a list.
	maxClearKeys = 40
	// choosePrefix starts the ids of the actions the agent makes for a choose, so their results
	// are not shown to the driving model as results of its own actions.
	choosePrefix = "ch"
)

// nudgeOffsets are how far, in screenshot pixels, the next try at opening a dropdown clicks below
// (positive) or above (negative) the point the model gave, when the click opened nothing. A
// model's point can land on a control's label, or on the gap between label and box, and a person
// would move down onto the box.
var nudgeOffsets = []float64{12, 24, -12}

// sourceChoose marks an entry where the agent looked at an open dropdown, with the decision
// model, to pick the option that answers a choose action.
const sourceChoose = "choose"

// script is a run of the model's actions with a choose in it, being carried out one dropdown at
// a time: queue holds what is left, and open is the dropdown that is open and waiting for a look.
type script struct {
	queue []Action
	open  *openList
	made  int
}

// nextID is a fresh id for an action the agent makes for a choose.
func (sc *script) nextID(seq int) string {
	sc.made++
	return fmt.Sprintf("s%d%s%d", seq, choosePrefix, sc.made)
}

// openList is a dropdown opened for a choose action.
type openList struct {
	choose Action
	// typed is how many characters were typed to narrow the list (0 before they were); cleared is
	// that they were taken back out, so the next look is at the whole list.
	typed   int
	cleared bool
	// nudges is how many more clicks were made because the list did not open.
	nudges int
}

// isChooseID is whether the agent made this action for a choose ("s12ch3", "s12ch3t").
func isChooseID(id string) bool {
	i := strings.Index(id, choosePrefix)
	return i > 0 && strings.HasPrefix(id, "s") && strings.Trim(id[1:i], "0123456789") == ""
}

// withoutChoose drops the results of the actions the agent made for a choose.
func withoutChoose(results []ActionResult) []ActionResult {
	var out []ActionResult
	for _, result := range results {
		if !isChooseID(result.ID) {
			out = append(out, result)
		}
	}
	return out
}

// hasChoose is whether any action is a choose.
func hasChoose(actions []Action) bool {
	for _, action := range actions {
		if action.Kind == KindChoose {
			return true
		}
	}
	return false
}

// bottomUp orders each run of consecutive chooses from the bottom of the screen to the top.
func bottomUp(actions []Action) []Action {
	out := append([]Action(nil), actions...)
	for i := 0; i < len(out); {
		if out[i].Kind != KindChoose {
			i++
			continue
		}
		j := i
		for j < len(out) && out[j].Kind == KindChoose {
			j++
		}
		run := out[i:j]
		sort.SliceStable(run, func(a, b int) bool { return *run[a].Y > *run[b].Y })
		i = j
	}
	return out
}

// plainChoose is a choose as plain input, for a run with no decision model to read the list:
// click the control, type the answer, press Enter.
func plainChoose(action Action) []Action {
	return []Action{
		{ID: action.ID, Kind: KindClick, X: action.X, Y: action.Y, ScrollTo: action.ScrollTo, PageHeight: action.PageHeight},
		{ID: action.ID + "t", Kind: KindType, Text: action.Text},
		{ID: action.ID + "e", Kind: KindKey, Keys: "Enter", Check: action.Check},
	}
}

// startScript turns a run of the model's actions into what the extension is sent first. A run
// with no choose goes as it is.
func (a *Agent) startScript(s *session, actions []Action) []Action {
	if !hasChoose(actions) {
		return actions
	}
	if !a.checksOn(s) {
		var out []Action
		for _, action := range actions {
			if action.Kind == KindChoose {
				out = append(out, plainChoose(action)...)
				continue
			}
			out = append(out, action)
		}
		return out
	}
	s.script = &script{queue: bottomUp(actions)}
	return a.dispatch(s, nil)
}

// dispatch builds the next batch for the extension: prefix, then the queue's actions up to and
// including the opening of the next dropdown, which then waits for a look.
func (a *Agent) dispatch(s *session, prefix []Action) []Action {
	sc := s.script
	batch := append([]Action(nil), prefix...)
	for len(sc.queue) > 0 {
		next := sc.queue[0]
		sc.queue = sc.queue[1:]
		if next.Kind != KindChoose {
			batch = append(batch, next)
			continue
		}
		id := sc.nextID(s.seq)
		click := Action{ID: id, Kind: KindClick, X: next.X, Y: next.Y, ScrollTo: next.ScrollTo, PageHeight: next.PageHeight}
		batch = append(batch, click)
		sc.open = &openList{choose: next}
		return batch
	}
	s.script = nil
	return batch
}

// optionCriteria are the answers the decision model may give about an open list.
func optionCriteria() map[string]string {
	criteria := map[string]string{optionNone: "no option of the open list answers it, or the first option of the list is not visible"}
	for i := 1; i <= maxOptionPosition; i++ {
		criteria[strconv.Itoa(i)] = "option number " + strconv.Itoa(i) + " of the open list, counting from its first option"
	}
	return criteria
}

// pickOption asks the decision model whether a dropdown list is open and, if it is, which of its
// options answers the choose action: the position counted from the list's first option, and whether
// the model was sure enough.
func (a *Agent) pickOption(ctx context.Context, s *session, obs Observation, answer string) (position int, listOpen bool, check verdict, err error) {
	questions := map[string]decide.Question{
		askListOpen: decide.YesNo("Is a dropdown list of choices open on this page right now: a list of options shown below or above a control, so that one can be picked?"),
		askOption: {
			Type: decide.TypeChoice,
			Instructions: "A dropdown list of choices is open on this page. Someone wants to choose the option that answers: " + strconv.Quote(answer) + ". " +
				"Counting from the first option of the list, which option is it? " +
				"Choose the option whose meaning matches: for a yes or no answer, the option that says yes or no, even when it goes on to explain. " +
				"If the list is scrolled so that its first option is not visible, answer none.",
			Criteria: optionCriteria(),
		},
	}
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: checkState(obs.Screenshot), Questions: questions})
	check = verdict{response: response, prompt: "which option of the open list answers " + strconv.Quote(answer)}
	if err != nil {
		return 0, false, check, err
	}
	if open, ok := response.Answers[askListOpen]; ok && open.Noul != nil {
		listOpen = *open.Noul >= listOpenMatch
	}
	found := response.Answers[askOption]
	position, convErr := strconv.Atoi(found.Choice)
	if convErr != nil || position < 1 || position > maxOptionPosition || found.Probabilities[found.Choice] < a.cfg.OptionMatch {
		return 0, listOpen, check, nil
	}
	return position, true, check, nil
}

// optionKeys goes to the first option of an open list (Home, as in any list box: the highlighted
// option follows the mouse pointer, so it is not necessarily the first), moves down to the one at
// position and picks it.
func optionKeys(position int) string {
	keys := make([]string, 0, position+1)
	keys = append(keys, "Home")
	for i := 1; i < position; i++ {
		keys = append(keys, "ArrowDown")
	}
	return strings.Join(append(keys, "Enter"), " ")
}

// continueScript carries on a run that has a dropdown open: it looks at the list, picks, and
// opens the next dropdown. It reports false when the model must look instead (the list did not
// answer, or something failed), and the rest of the run is dropped.
func (a *Agent) continueScript(ctx context.Context, s *session, obs Observation, results []ActionResult, sig []uint8) (Step, bool) {
	sc := s.script
	if sc == nil || sc.open == nil {
		return Step{}, false
	}
	open := sc.open
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceChoose, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
	}
	if failed := failedResults(obs.Results); failed != "" {
		s.script = nil
		a.abandon(s, "The last actions failed: "+failed+".")
		return Step{}, false
	}
	position, listOpen, check, err := a.pickOption(ctx, s, obs, open.choose.Text)
	s.usage.Checks++
	s.usage.CheckCost += check.response.Usage.Cost
	s.usage.Cost += check.response.Usage.Cost
	entry.Usage = s.usage
	if err != nil {
		slog.Warn("option check failed", "session", s.id, "error", err)
	}
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig

	var step Step
	switch {
	case position > 0:
		key := Action{ID: sc.nextID(s.seq), Kind: KindKey, Keys: optionKeys(position)}
		sc.open = nil
		step = Step{Status: StatusWorking, Message: s.message, Actions: a.dispatch(s, []Action{key}), Number: s.step, Usage: s.usage}
	case err != nil || open.cleared:
		// Nothing answers even in the whole list (or the checker failed): the model looks, with the list open.
		return a.giveUp(s, obs, entry, open, []modelCall{check.call(err)})
	case open.typed > 0:
		// The typed words found no option: take them back out and look at the whole list.
		open.cleared = true
		backspaces := make([]string, min(open.typed, maxClearKeys))
		for i := range backspaces {
			backspaces[i] = "Backspace"
		}
		clear := Action{ID: sc.nextID(s.seq), Kind: KindKey, Keys: strings.Join(backspaces, " ")}
		step = Step{Status: StatusWorking, Message: s.message, Actions: []Action{clear}, Number: s.step, Usage: s.usage}
	case !listOpen && open.nudges < len(nudgeOffsets):
		// The click opened nothing, so typing would go nowhere: click again, a little lower or higher.
		click := nudgedClick(sc.nextID(s.seq), open.choose, nudgeOffsets[open.nudges], obs.Viewport)
		open.nudges++
		step = Step{Status: StatusWorking, Message: s.message, Actions: []Action{click}, Number: s.step, Usage: s.usage}
	case !listOpen:
		return a.giveUp(s, obs, entry, open, []modelCall{check.call(err)})
	default:
		// The list is open: narrow it by typing the answer, so that few options are left to choose
		// among (a model counts three options reliably and ten not), and look again.
		open.typed = len([]rune(open.choose.Text))
		typed := Action{ID: sc.nextID(s.seq), Kind: KindType, Text: open.choose.Text}
		step = Step{Status: StatusWorking, Message: s.message, Actions: []Action{typed}, Number: s.step, Usage: s.usage}
	}
	entry.Status, entry.Message, entry.Actions = step.Status, step.Message, step.Actions
	a.record(s, entry, obs.Screenshot, []modelCall{check.call(err)})
	return step, true
}

// giveUp ends a choose that found no sure option: the list is left open, and the model looks at it
// and picks for itself, with a note saying which answer it was.
func (a *Agent) giveUp(s *session, obs Observation, entry stepTrace, open *openList, calls []modelCall) (Step, bool) {
	s.script = nil
	s.notes = append(s.notes, fmt.Sprintf("You asked Acorn to choose %q in the dropdown at %.0f,%.0f, but no option of its list was a sure match, so nothing was chosen. Its list is open on this screen: pick the option yourself, then plan the rest of the screen again.", open.choose.Text, *open.choose.X, *open.choose.Y))
	a.abandon(s, "The rest of your plan did not run.")
	entry.Status, entry.Message, entry.Usage = StatusWorking, s.message, s.usage
	a.record(s, entry, obs.Screenshot, calls)
	return Step{}, false
}

// nudgedClick is a click at the choose action's point moved dy pixels down (up when negative), kept on the screen.
func nudgedClick(id string, choose Action, dy float64, vp Viewport) Action {
	y := math.Min(math.Max(*choose.Y+dy, 0), float64(vp.Height-1))
	return Action{ID: id, Kind: KindClick, X: choose.X, Y: &y, ScrollTo: choose.ScrollTo, PageHeight: choose.PageHeight}
}
