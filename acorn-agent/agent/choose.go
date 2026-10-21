package agent

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A dropdown the page draws itself hides its options until it is opened, and the driving model
// only sees them on its next look: one call (about 7 s) per dropdown, and a click aimed at an
// option can land on the wrong one when the list moves. So the driving model says only what each
// dropdown should be set to (a "choose" action: the control's point and the answer in words), and
// the agent does the rest: open the control and read the list.
//
// The open list is read from its picture (listread.go): the decision model says whether a list is open,
// whether the box already shows the answer, and which option answers; where the page says it drew each
// option, the options in view are numbered on the picture and the pick is a click on the numbered one, else
// the option is counted from the list's first and reached with Home, ArrowDown and Enter. When none
// answers, the driving model chooses on its next look: it knows the applicant, and a list that splits
// "Asian" into East, South and Southeast is its call, not a thing to retry. A click can miss the control:
// it is moved onto the box and tried again, and nothing is ever typed into a list that is not open, since
// typed spaces scroll the page. Typing is for one case only: a list that is open but shows no answer (too
// long, or one that searches as one types) gets the start of the answer typed, and is read again. The
// options of a list the browser draws itself (a native select) are the one thing read as text: no picture
// ever shows that popup. The extension only ever receives a click, some typing and keys.
//
// Several dropdowns in one plan are set from the bottom of the screen up: a choice can add or
// remove a message under its control, which moves everything below it but nothing above.

const (
	// askOption is the decision model's question about an open list in a picture.
	askOption = "option"
	// askListOpen is its question of whether a list is open at all: a click that missed the
	// control opens nothing, and typing then would go nowhere.
	askListOpen = "list_open"
	// listOpenMatch is how sure the decision model must be that a list is open.
	listOpenMatch = 0.5
	// askListedOption is its question about a native list, whose options the browser reports as text.
	askListedOption = "listed_option"
	// listedOptionPrefix starts the criteria keys of the questions about options.
	listedOptionPrefix = "option_"
	// maxListedOptionChars bounds one option's text in that question and in a note to the model.
	maxListedOptionChars = 120
	// maxListedInNote bounds the options a note tells the driving model of.
	maxListedInNote = 40
	// optionNone is its answer when no option answers.
	optionNone = "none"
	// maxOptionPosition is how far down an open list the decision model counts in a picture.
	maxOptionPosition = 12
	// maxClearKeys bounds the backspaces that clear what was typed to narrow a list.
	maxClearKeys = 40
	// choosePrefix starts the ids of the actions the agent makes for a choose, so their results
	// are not shown to the driving model as results of its own actions.
	choosePrefix = "ch"
)

// optionLoadWaitMs is the extra beat a narrowed list is given when it shows nothing, in case its
// options are still being fetched.
const optionLoadWaitMs = 800

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
	// waited is that the narrowed list was given one more beat to arrive (a list that loads from a
	// server can be empty when first looked at) before the typing was taken back out.
	waited bool
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

// pageTop is where a point action aims on the page, from its top: the screen of the survey it was
// measured on, and its place on that screen. Two points on different screens are only ordered by this.
func pageTop(action Action) float64 {
	top := 0.0
	if action.ScrollTo != nil {
		top = *action.ScrollTo
	}
	return top + *action.Y
}

// bottomUp orders each run of consecutive chooses from the bottom of the page to the top.
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
		sort.SliceStable(run, func(a, b int) bool { return pageTop(run[a]) > pageTop(run[b]) })
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
	if a.probing(s) {
		return a.startProbe(s, actions)
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
		s.carryAnchor(next.ID, id)
		batch = append(batch, click)
		sc.open = &openList{choose: next}
		return batch
	}
	s.script = nil
	return batch
}

// optionKeys goes to the first option of an open list (Home, as in any list box: the highlighted
// option follows the mouse pointer, so it is not necessarily the first), moves down to the one at
// position and picks it.
// optionPick is the action that picks the n-th option (position, from 1) of an open list: a click on the
// option where the page said it is drawn, at the scroll the list was read at (scrollY, screenshot pixels),
// else, when the page did not say or the option is drawn off the screen, the keys that reach it. A pick
// is a click wherever a click is possible: the option is what the applicant would press, and a list that
// closes or moves on an arrow key is not pressed by keys. A native list (the browser's own popup) is never
// in a picture, so it is always keyed (chooseNative).
func optionPick(id string, list *OpenList, position int, scrollY float64, vp Viewport) Action {
	if box, ok := list.optionBox(position - 1); ok {
		cx, cy := box.center()
		x, y := cx-vp.ScrollX, cy-scrollY
		if x >= 0 && y >= 0 && x < float64(vp.Width) && y < float64(vp.Height) {
			// The option was placed on the picture of the open list, not on a survey screen: the click is made
			// where the window was then, with no page height, so the form's moves since the survey are not
			// applied to it a second time.
			top := scrollY
			return Action{ID: id, Kind: KindClick, X: &x, Y: &y, ScrollTo: &top}
		}
	}
	return Action{ID: id, Kind: KindKey, Keys: optionKeys(position)}
}

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
	if options := nativeList(obs.Focus); options != nil {
		return a.chooseNative(ctx, s, obs, entry, results, sig, options)
	}
	read, check, readErr := a.readListPicture(ctx, s, obs.Screenshot, open.choose.Text, chooseLabel(open.choose, nil), obs.List, obs.Viewport.ScrollY, open.typed == 0)
	s.usage.Checks++
	s.usage.CheckCost += check.response.Usage.Cost
	s.usage.Cost += check.response.Usage.Cost
	calls := []modelCall{check.call(readErr)}
	entry.Usage = s.usage
	if readErr != nil {
		slog.Warn(runName(s.id)+": could not tell which option of the open list to pick.", plainlog.ErrorKey, readErr)
	}
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig

	var step Step
	switch {
	case readErr == nil && read.shows && open.typed == 0:
		// The box shows the answer already: close what the click opened and go on to the next dropdown.
		sc.open = nil
		escape := Action{ID: sc.nextID(s.seq), Kind: KindKey, Keys: "Escape"}
		step = Step{Status: StatusWorking, Message: s.message, Actions: a.dispatch(s, []Action{escape}), Number: s.step, Usage: s.usage}
	case read.position > 0:
		var list *OpenList
		if read.numbered {
			list = obs.List
		}
		pick := optionPick(sc.nextID(s.seq), list, read.position, obs.Viewport.ScrollY, obs.Viewport)
		sc.open = nil
		step = Step{Status: StatusWorking, Message: s.message, Actions: a.dispatch(s, []Action{pick}), Number: s.step, Usage: s.usage}
	case readErr != nil || open.cleared:
		// Nothing answers even in the whole list (or the checker failed): the model looks, with the list open.
		return a.giveUp(s, obs, entry, open, nil, calls)
	case open.typed > 0 && !open.waited:
		// A list that loads from a server as one types may not be there yet: wait a beat and look again
		// before deciding that the words found nothing.
		open.waited = true
		pause := Action{ID: sc.nextID(s.seq), Kind: KindWait, Ms: optionLoadWaitMs}
		step = Step{Status: StatusWorking, Message: s.message, Actions: []Action{pause}, Number: s.step, Usage: s.usage}
	case open.typed > 0:
		// The typed words found no option: take them back out and look at the whole list.
		open.cleared = true
		backspaces := make([]string, min(open.typed, maxClearKeys))
		for i := range backspaces {
			backspaces[i] = "Backspace"
		}
		clear := Action{ID: sc.nextID(s.seq), Kind: KindKey, Keys: strings.Join(backspaces, " ")}
		step = Step{Status: StatusWorking, Message: s.message, Actions: []Action{clear}, Number: s.step, Usage: s.usage}
	case !read.open && open.nudges < len(nudgeOffsets):
		// The click opened nothing, so typing would go nowhere: click again, a little lower or higher.
		click := a.nudgedClick(s, sc.nextID(s.seq), open.choose, nudgeOffsets[open.nudges], obs.Viewport)
		open.nudges++
		step = Step{Status: StatusWorking, Message: s.message, Actions: []Action{click}, Number: s.step, Usage: s.usage}
	case !read.open:
		return a.giveUp(s, obs, entry, open, nil, calls)
	default:
		// The list is open and shows no answer in its picture: narrow it by typing the answer, so that few
		// options are left to choose among, and look again.
		open.typed = len([]rune(open.choose.Text))
		typed := Action{ID: sc.nextID(s.seq), Kind: KindType, Text: open.choose.Text}
		step = Step{Status: StatusWorking, Message: s.message, Actions: []Action{typed}, Number: s.step, Usage: s.usage}
	}
	entry.Status, entry.Message, entry.Actions = step.Status, step.Message, step.Actions
	a.record(s, entry, obs.Screenshot, calls)
	return step, true
}

// giveUp ends a choose that found no sure option: the list is left open, and the model looks at it
// and picks for itself, with a note saying which answer it was and, when the page named the options,
// what they are.
func (a *Agent) giveUp(s *session, obs Observation, entry stepTrace, open *openList, options []string, calls []modelCall) (Step, bool) {
	s.script = nil
	if options != nil {
		s.notes = append(s.notes, unsureNote(open.choose, options))
	} else {
		s.notes = append(s.notes, fmt.Sprintf("You asked Acorn to choose %q in the dropdown at %.0f,%.0f, but no option of its list was a sure match, so nothing was chosen. Its list is open on this screen: click the option you can see on the screenshot, then plan the rest of the screen again.", open.choose.Text, *open.choose.X, *open.choose.Y))
	}
	a.abandon(s, "The rest of your plan did not run.")
	entry.Status, entry.Message, entry.Usage = StatusWorking, s.message, s.usage
	a.record(s, entry, obs.Screenshot, calls)
	return Step{}, false
}

// unsureNote tells the model which dropdown found no sure option, so it chooses on its next look; for a
// native list, whose popup no picture shows, it is told the options, and a choose whose text is the option's
// own words is picked with no further question.
func unsureNote(choose Action, options []string) string {
	where := fmt.Sprintf("at %.0f,%.0f", *choose.X, *choose.Y)
	if choose.Zone > 0 {
		where += fmt.Sprintf(" on screen %d", choose.Zone)
	}
	name := ""
	if label := strings.TrimSpace(choose.Label); label != "" {
		name = fmt.Sprintf(" %q", label)
	}
	if len(options) == 0 {
		return fmt.Sprintf("You asked Acorn to choose %q in the dropdown%s %s, but its list showed no option for those words, so it was left unset. Look at it on the survey and plan a choose on it again, with the answer as the list might word it (the list may use other words than the applicant's); if its list is open on the screenshot, click the option that answers.", choose.Text, name, where)
	}
	return fmt.Sprintf("You asked Acorn to choose %q in the dropdown%s %s, but none of its options was a sure match, so it was left unset. Its options are: %s. Choose again from them: plan a choose on the same box whose \"text\" is the option's own words, or leave it when none fits.", choose.Text, name, where, listedLine(options))
}

// listedLine numbers options for the model and the trace: 1 "No", 2 "Yes", and how many more.
func listedLine(options []string) string {
	parts := make([]string, 0, min(len(options), maxListedInNote)+1)
	for i, option := range options {
		if i == maxListedInNote {
			parts = append(parts, fmt.Sprintf("and %d more", len(options)-i))
			break
		}
		parts = append(parts, fmt.Sprintf("%d %q", i+1, clipText(option, maxListedOptionChars)))
	}
	return strings.Join(parts, "; ")
}

// chooseLabel is what the dropdown of a choose is called: the model's label for it, else the focused control's.
func chooseLabel(choose Action, focus *Focus) string {
	if label := strings.TrimSpace(choose.Label); label != "" {
		return label
	}
	return focusLabel(focus)
}

// nudgedClick is a click at the choose action's point moved dy pixels down (up when negative), kept on the screen.
// It keeps the dropdown's anchor, so a page that changed height is found at the control, not at the nudge.
func (a *Agent) nudgedClick(s *session, id string, choose Action, dy float64, vp Viewport) Action {
	y := math.Min(math.Max(*choose.Y+dy, 0), float64(vp.Height-1))
	s.carryAnchor(choose.ID, id)
	return Action{ID: id, Kind: KindClick, X: choose.X, Y: &y, ScrollTo: choose.ScrollTo, PageHeight: choose.PageHeight}
}

// nativeList is the options of the control that has focus when it is a native list: the browser
// draws its popup itself, so a screenshot never shows it (and "no list is open" would be wrong),
// but the page reports the options as text.
func nativeList(focus *Focus) []string {
	if focus == nil || focus.Tag != "select" || len(focus.Options) == 0 {
		return nil
	}
	return focus.Options
}

// chooseNative picks the option of a focused native list that answers the choose action. The options
// are text, so the decision model chooses among them by their wording, with no counting of rows in a
// picture. The option is typed whole (a list matches what is typed to its options as it goes, so the
// whole text selects that one and no other) and Enter commits it. No arrow keys, Home or clicks are
// sent: keys that reach a page, not a list, scroll it.
func (a *Agent) chooseNative(ctx context.Context, s *session, obs Observation, entry stepTrace, results []ActionResult, sig []uint8, options []string) (Step, bool) {
	sc := s.script
	open := sc.open
	index, check, asked, err := a.decideListed(ctx, s, open.choose.Text, options, focusLabel(obs.Focus))
	if !asked {
		return a.commitNative(s, obs, entry, results, sig, options[index], nil)
	}
	s.usage.Checks++
	s.usage.CheckCost += check.response.Usage.Cost
	s.usage.Cost += check.response.Usage.Cost
	entry.Usage = s.usage
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig
	if err != nil {
		slog.Warn(runName(s.id)+": could not tell which option of the browser's own list to pick.", plainlog.ErrorKey, err)
	}
	if index < 0 {
		return a.giveUp(s, obs, entry, open, options, []modelCall{check.call(err)})
	}
	return a.commitNative(s, obs, entry, results, sig, options[index], []modelCall{check.call(nil)})
}

// decideListed is which of a list's options, given as text, answers a choose action, as an index (-1:
// none does). asked says whether the decision model was asked: an option that says exactly the answer
// needs no judgment, and the model's own reading cannot be trusted with it (when one option is the
// answer and another only begins with it, a recorded run had the model split its weight between the
// two, and the choose never completed). The model's best option is taken when it is sure of it, or
// when it leads clearly (optionAccepted).
func (a *Agent) decideListed(ctx context.Context, s *session, answer string, options []string, label string) (index int, check verdict, asked bool, err error) {
	if exact, ok := exactOption(answer, options); ok {
		return exact, verdict{}, false, nil
	}
	criteria := map[string]string{optionNone: "no option answers it"}
	for i, option := range options {
		criteria[listedOptionPrefix+strconv.Itoa(i)] = clipText(option, maxListedOptionChars)
	}
	questions := map[string]decide.Question{askListedOption: {
		Type: decide.TypeChoice,
		Instructions: "A form has a dropdown list. Someone wants to choose the option that answers: " + strconv.Quote(answer) + ". " +
			"Which option is it? Choose the option whose meaning matches: for a yes or no answer, the option that says yes or no, even when it goes on to explain. " +
			"An option that is exactly the answer beats one that only begins with it or contains it. " +
			"Answer none if no option answers it.",
		Criteria: criteria,
	}}
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: []decide.Part{decide.Text("The label of the list: " + label)}, Questions: questions})
	check = verdict{response: response, prompt: fmt.Sprintf("which of the listed options answers %q: %s", answer, listedLine(options))}
	index = -1
	if err != nil {
		return index, check, true, err
	}
	key, ok := a.optionAccepted(response.Answers[askListedOption])
	if !ok {
		return index, check, true, nil
	}
	if i, found := strings.CutPrefix(key, listedOptionPrefix); found {
		if n, convErr := strconv.Atoi(i); convErr == nil && n >= 0 && n < len(options) {
			index = n
		}
	}
	return index, check, true, nil
}

// optionAccepted is the listed option the decision model's answer may be taken for: the one with the
// most weight, when the model is sure of it (OptionMatch), or when it leads clearly (OptionAccept, and no
// other option has more than half its weight). "None" is not an option.
func (a *Agent) optionAccepted(found decide.Answer) (key string, ok bool) {
	best, bestWeight, second := "", 0.0, 0.0
	for candidate, weight := range found.Probabilities {
		if !strings.HasPrefix(candidate, listedOptionPrefix) {
			continue
		}
		switch {
		case weight > bestWeight:
			best, bestWeight, second = candidate, weight, bestWeight
		case weight > second:
			second = weight
		}
	}
	if best == "" {
		return "", false
	}
	if bestWeight >= a.cfg.OptionMatch {
		return best, true
	}
	if a.cfg.OptionAccept > 0 && bestWeight >= a.cfg.OptionAccept && second <= bestWeight/2 {
		return best, true
	}
	return "", false
}

// commitNative types a native list's option whole and presses Enter, then goes on to the next dropdown.
func (a *Agent) commitNative(s *session, obs Observation, entry stepTrace, results []ActionResult, sig []uint8, option string, calls []modelCall) (Step, bool) {
	sc := s.script
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig
	sc.open = nil
	typed := Action{ID: sc.nextID(s.seq), Kind: KindType, Text: option}
	commit := Action{ID: sc.nextID(s.seq), Kind: KindKey, Keys: "Enter"}
	step := Step{Status: StatusWorking, Message: s.message, Actions: a.dispatch(s, []Action{typed, commit}), Number: s.step, Usage: s.usage}
	entry.Usage = s.usage
	entry.Status, entry.Message, entry.Actions = step.Status, step.Message, step.Actions
	a.record(s, entry, obs.Screenshot, calls)
	return step, true
}

// exactOption is the one option whose text is the answer, ignoring case and spacing; none when no option
// is, or when two are.
func exactOption(answer string, options []string) (int, bool) {
	want := strings.Join(strings.Fields(strings.ToLower(answer)), " ")
	found := -1
	for i, option := range options {
		if strings.Join(strings.Fields(strings.ToLower(option)), " ") != want {
			continue
		}
		if found >= 0 {
			return 0, false
		}
		found = i
	}
	return found, found >= 0
}

func focusLabel(focus *Focus) string {
	if focus == nil || focus.Label == "" {
		return "(none)"
	}
	return focus.Label
}
