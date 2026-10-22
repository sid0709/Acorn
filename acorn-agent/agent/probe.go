package agent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// Dropdowns that the page draws itself are set in one pass, in the plan's own order with the rest of it
// (top to bottom, as the model planned the page): the extension clicks the dropdown open, waits a moment and
// takes a picture (a snap action), and sends it to the agent, which reads it at once (listread.go) and
// answers with what to do while the list is still open (ReceiveShot, answerSnap):
//
//   - the box already shows the answer: close the list (Escape);
//   - a good option is in view: click it, where the page drew it, else by its place;
//   - the list is open but shows no answer (too long, or one that searches as one types): type the start of
//     the answer into it, wait for it to narrow or load, and take another picture, read the same way; a list
//     that still shows nothing is given one longer wait;
//   - the click opened nothing: click a little above or below and take another picture, one try at a time;
//   - a native list (the browser draws its popup outside the page, in no picture and out of reach of a click
//     or a key) is never opened: the control is given focus, its options are read from the focus report as
//     text, the decision model picks one, and it is set by its place (KindSelect); the closed box then shows
//     it, where the zone's photo confirms it;
//   - typing into a field that then opens a list of suggestions (a city, an address) is finished the same
//     way as a choose: the extension photographs the open list, the option that answers is picked from the
//     picture and clicked, a list still loading is given a moment and photographed again;
//   - nothing answers: close the list, and the driving model chooses on its next look, told which dropdown
//     and, when the page named them, the options its list showed, so it chooses from the list's own words.
//
// The extension carries out the answer on the spot and goes on with the plan, so a dropdown is opened once and
// its option clicked while its list is open: no close and open again, no look between. A dropdown whose
// picture never reached the agent goes to the script (choose.go) when the plan is done. Nothing the page
// reports of its controls decides any of this: only where the options are drawn.

const (
	// probeOpenWaitMs is how long an opened list is given to draw before its picture is taken.
	probeOpenWaitMs = 400
	// probeTypedWaitMs is how long a list is given to narrow, or to load from a server, after the answer is typed.
	probeTypedWaitMs = 800
	// probeTypedRetryWaitMs is the longer wait a typed list that still shows nothing is given once: a list
	// fetched from a server over a slow line.
	probeTypedRetryWaitMs = 2500
	// typedMinChars is the least a first part of the answer must have to be typed on its own: a list that
	// searches as one types is narrowed by the start of the answer ("Fresno"), not the whole of it
	// ("Fresno, California, United States"), which a search may not match as a whole.
	typedMinChars = 3
	// directMaxPosition is the furthest down an unnarrowed list an option is picked by its place in a
	// picture: a model counts three options reliably and ten not, so anything further is narrowed by typing
	// first. Options numbered on the picture have no such limit: the number is read, not counted.
	directMaxPosition = 6
	// probeEscape is the key that closes an opened list.
	probeEscape = "Escape"
	// typedListSnapSuffix ends the id of the picture the extension takes when typing opened a list of
	// suggestions: the type action's id and this (the same suffix in the extension).
	typedListSnapSuffix = "l"
	// nativeListIDPrefix begins the id the page gives a select element (its tag).
	nativeListIDPrefix = "select:"
)

// probeItem is one dropdown of the plan.
type probeItem struct {
	choose Action
	// snapID is the snap action whose picture is this dropdown's now; typed is that the answer was typed into
	// the list, typedText what was typed, and retried that the longer wait was given.
	snapID    string
	typed     bool
	typedText string
	retried   bool
	// nudged is that the dropdown was opened again a little off the model's point, and nudge how many tries
	// were made.
	nudged bool
	nudge  int
	// What the last reading decided: a place in the list, the text of an option of a native list, that the
	// click opened nothing (closed), that the list needs the answer typed (needs), that no option answered
	// (unsure), or that the box already shows the answer (done).
	pick   int
	native string
	closed bool
	needs  bool
	unsure bool
	done   bool
	// list places the options of the list the pick was read from (nil when it was counted in the picture),
	// and listScrollY is the scroll its picture was taken at: the pick clicks the option there (optionPick).
	list        *OpenList
	listScrollY float64
	// settled is that the dropdown was set (or closed for the model) while its list was open.
	settled bool
	// options are the options of the list as the page named them in its latest picture: for the note that
	// leaves the dropdown to the model when none answered, so it chooses from the list's own words instead
	// of guessing another wording (a recorded run guessed five, one a look, for one box).
	options []string
	// nativeIndex is the place (from 0) of the native option picked, with native its words.
	nativeIndex int
	// fromType is that the item is typing the model planned into a field that opened a list of suggestions,
	// not a choose: the typed text is the answer, and nothing is typed again. listOpen is what the latest
	// picture showed of a list.
	fromType bool
	listOpen bool
}

// probeRun is the plan with dropdowns in it, being carried out in one batch.
type probeRun struct {
	items []*probeItem
	made  int
}

// nextID is a fresh id for an action the agent makes for a dropdown.
func (pr *probeRun) nextID(seq int) string {
	pr.made++
	return fmt.Sprintf("s%d%s%d", seq, choosePrefix, pr.made)
}

// probing is whether fast-fill runs set their dropdowns in one pass.
func (a *Agent) probing(s *session) bool {
	return s.start.FastFill && a.cfg.ProbeDropdowns && a.checksOn(s)
}

// startProbe turns the plan into one batch, in its own order: every action as it is, and every dropdown as
// a click that opens it, a wait, and a picture the agent answers while the list is open.
func (a *Agent) startProbe(s *session, actions []Action) []Action {
	s.probe = &probeRun{}
	var batch []Action
	for _, action := range actions {
		if action.Kind != KindChoose {
			batch = append(batch, action)
			continue
		}
		item := &probeItem{choose: action}
		s.probe.items = append(s.probe.items, item)
		batch = append(batch, a.probeOpen(s, item, action)...)
	}
	return batch
}

// helper is an action of the agent's own for a dropdown, aimed where `at` aims and in the dropdown's zone,
// so the photo of the zone is taken once the dropdown is set. A click carries the dropdown's anchor and
// control, so its point is found again if the page changes shape.
func (a *Agent) helper(s *session, choose, at Action, id string, kind string) Action {
	action := Action{ID: id, Kind: kind, Zone: choose.Zone}
	if kind == KindClick || kind == KindFocus || kind == KindSelect {
		action.X, action.Y, action.ScrollTo, action.PageHeight = at.X, at.Y, at.ScrollTo, at.PageHeight
		s.carryAnchor(choose.ID, id)
	}
	return action
}

// probeOpen opens a dropdown at the point of `at` (the model's, or a nudge of it), waits for its list to
// draw, and takes its picture. A dropdown the page reports as the browser's own list (its control is a
// select element) is not opened, only given focus: its popup would be a window of the operating system,
// in no picture and out of reach of every later click and key (a recorded run opened one and could not
// set or close it for six steps); the focus report names its options, and the pick is made from those.
func (a *Agent) probeOpen(s *session, item *probeItem, at Action) []Action {
	pr := s.probe
	item.snapID = pr.nextID(s.seq)
	reach := KindClick
	if s.boundToNativeList(item.choose) {
		reach = KindFocus
	}
	return []Action{
		a.helper(s, item.choose, at, pr.nextID(s.seq), reach),
		{ID: pr.nextID(s.seq), Kind: KindWait, Ms: probeOpenWaitMs, Zone: item.choose.Zone},
		{ID: item.snapID, Kind: KindSnap, Zone: item.choose.Zone},
	}
}

// boundToNativeList is whether the plan bound this choose to a select element of the page (the control's
// id begins with its tag). The page's list says what kind of control it is, not what it holds.
func (s *session) boundToNativeList(choose Action) bool {
	ref, ok := s.marks[choose.ID]
	return ok && strings.HasPrefix(ref.ID, nativeListIDPrefix)
}

// typedPointsOf is, for each type action of a plan, the point action before it: the click on the field the
// text goes into. Typing that opens a list of suggestions is then finished as a choose on that field.
func typedPointsOf(planned []Action) map[string]Action {
	out := map[string]Action{}
	var last *Action
	for i := range planned {
		switch {
		case isPointAction(planned[i]):
			last = &planned[i]
		case planned[i].Kind == KindType && last != nil && !planned[i].Secret:
			out[planned[i].ID] = *last
		}
	}
	return out
}

// typedAnswer is what is typed to narrow a list: the first part of the answer when it has several
// ("Fresno" of "Fresno, California, United States"), else the whole answer. The option is still matched
// against the whole answer once the list shows.
func typedAnswer(answer string) string {
	first, _, found := strings.Cut(answer, ",")
	first = strings.TrimSpace(first)
	if !found || len([]rune(first)) < typedMinChars {
		return strings.TrimSpace(answer)
	}
	return first
}

// apply sets what a reading of a dropdown's picture decided.
func (item *probeItem) apply(read listReading, snap ShotUpload) {
	item.closed, item.needs = false, false
	limit := directMaxPosition
	if read.numbered || item.typed {
		limit = maxOptionPosition
	}
	item.listOpen = read.open
	switch {
	case read.shows && !item.typed:
		item.done = true
	case read.position > 0 && (read.numbered || read.position <= limit):
		item.pick, item.list, item.listScrollY = read.position, nil, snap.ScrollY
		if read.numbered {
			item.list = snap.List
		}
	case !read.open && !item.typed && item.nudge < len(nudgeOffsets):
		item.closed = true
	case !item.typed:
		// A list too long to count, not drawn yet, or one that searches as one types: type the start of the
		// answer and look again.
		item.needs = true
	case !read.open && !item.retried:
		// Typed, and still no list in the picture: once more, with time for a list that loads.
		item.needs = true
	case item.fromType && !item.retried:
		// A list opened by typing that shows no option yet (it is still loading): once more, after a moment.
		item.needs = true
	default:
		item.unsure = true
	}
}

// reading is what reading one dropdown's picture made, for the trace and the usage.
type reading struct {
	calls   []modelCall
	cost    float64
	failure error
}

// add counts one decision call of a reading.
func (r *reading) add(check verdict, err error) {
	r.calls = append(r.calls, check.call(err))
	r.cost += check.response.Usage.Cost
	if err != nil {
		r.failure = err
	}
}

// readOne reads one dropdown's snap: a native list's options (the browser draws its popup outside the page,
// so the page's text is all there is), else the picture.
func (a *Agent) readOne(ctx context.Context, s *session, item *probeItem, snap ShotUpload) reading {
	var out reading
	if options := nativeList(snap.Focus); options != nil && !item.typed {
		// The note that leaves the dropdown to the model names these too: a native list's popup is in no picture.
		item.options = options
		index, check, asked, err := a.decideListed(ctx, s, item.choose.Text, options, focusLabel(snap.Focus))
		if index >= 0 && err == nil {
			item.native, item.nativeIndex = options[index], index
		}
		if asked {
			out.add(check, err)
		}
		return out
	}
	if snap.List != nil && len(snap.List.Options) > 0 {
		item.options = snap.List.Options
	}
	read, check, err := a.readListPicture(ctx, s, snap.Screenshot, item.choose.Text, chooseLabel(item.choose, nil), snap.List, snap.ScrollY, !item.typed)
	out.add(check, err)
	if err == nil {
		item.apply(read, snap)
	}
	return out
}

// itemBySnap is the dropdown whose picture this is.
func (pr *probeRun) itemBySnap(id string) *probeItem {
	for _, item := range pr.items {
		if item.snapID == id {
			return item
		}
	}
	return nil
}

// answerSnap reads the picture of an opened dropdown at once and says what the extension does next while the
// list is open. The decision calls go to the trace with the next entry. The session is locked.
func (a *Agent) answerSnap(ctx context.Context, s *session, upload ShotUpload) []Action {
	if then, ok := a.answerCheckRetry(ctx, s, upload); ok {
		return then
	}
	pr := s.probe
	if pr == nil {
		return nil
	}
	item := pr.itemBySnap(upload.ID)
	if item == nil {
		item = s.typedListItem(upload.ID)
	}
	if item == nil || item.settled {
		return nil
	}
	item.pick, item.native, item.unsure, item.done = 0, "", false, false
	read := a.readOne(ctx, s, item, upload)
	s.usage.Checks += len(read.calls)
	s.usage.CheckCost += read.cost
	s.usage.Cost += read.cost
	s.reviews.calls = append(s.reviews.calls, read.calls...)
	if read.failure != nil {
		slog.Warn(runName(s.id)+": could not read the list of a dropdown; the model chooses on its next look.", plainlog.ErrorKey, read.failure)
		item.unsure, item.closed, item.needs = true, false, false
	}
	seq := s.seq
	zone := item.choose.Zone
	var then []Action
	switch {
	case item.native != "":
		// The browser's own list: the option is set by its place, never through its popup (see the top).
		item.settled = true
		index := item.nativeIndex
		set := a.helper(s, item.choose, item.choose, pr.nextID(seq), KindSelect)
		set.Index, set.Option = &index, item.native
		then = []Action{set}
		s.noteChosen(item.choose, item.native)
	case item.done:
		item.settled = true
		then = []Action{{ID: pr.nextID(seq), Kind: KindKey, Keys: probeEscape, Zone: zone}}
	case item.pick > 0:
		item.settled = true
		pick := optionPick(pr.nextID(seq), item.list, item.pick, item.listScrollY, s.viewport)
		pick.Zone = zone
		then = []Action{pick}
		// The review of the zone asks for the option in the page's own words, when the page named it.
		if item.list != nil && item.pick <= len(item.list.Options) {
			s.noteChosen(item.choose, item.list.Options[item.pick-1])
		}
	case item.closed:
		// The click opened nothing: try a little off the model's point, one try at a time.
		item.nudged = true
		moved := item.choose
		y := *item.choose.Y + nudgeOffsets[item.nudge]
		moved.Y = &y
		item.nudge++
		then = a.probeOpen(s, item, moved)
	case item.needs && !item.typed:
		item.typed, item.typedText, item.snapID = true, typedAnswer(item.choose.Text), pr.nextID(seq)
		then = []Action{
			{ID: pr.nextID(seq), Kind: KindType, Text: item.typedText, Zone: zone},
			{ID: pr.nextID(seq), Kind: KindWait, Ms: probeTypedWaitMs, Zone: zone},
			{ID: item.snapID, Kind: KindSnap, Zone: zone},
		}
	case item.needs:
		item.retried, item.snapID = true, pr.nextID(seq)
		wait := probeTypedRetryWaitMs
		if item.fromType {
			wait = probeTypedWaitMs
		}
		then = []Action{
			{ID: pr.nextID(seq), Kind: KindWait, Ms: wait, Zone: zone},
			{ID: item.snapID, Kind: KindSnap, Zone: zone},
		}
	case item.fromType && !item.listOpen:
		// Typing that opened no list after all (a message under the field, a counter): nothing to pick.
		item.settled = true
	default:
		// Nothing answers: the list is closed and the driving model chooses on its next look.
		item.unsure, item.settled = true, true
		then = []Action{{ID: pr.nextID(seq), Kind: KindKey, Keys: probeEscape, Zone: zone}}
	}
	s.attachMarks(then)
	return then
}

// continueProbe ends a plan whose dropdowns were set in one pass, at the look after its batch: a dropdown no
// option of which answered is left to the driving model, and one whose picture never reached the agent goes
// to the script, which sets it one at a time. It reports false when there is nothing of the probe left to do.
func (a *Agent) continueProbe(ctx context.Context, s *session, obs Observation, results []ActionResult, sig []uint8) (Step, bool) {
	pr := s.probe
	if pr == nil {
		return Step{}, false
	}
	s.probe = nil
	var asking, unread []*probeItem
	for _, item := range pr.items {
		switch {
		case item.unsure:
			asking = append(asking, item)
		case !item.settled:
			unread = append(unread, item)
		}
	}
	a.leaveToModel(s, asking)
	if len(unread) == 0 || failedResults(obs.Results) != "" {
		// A failed batch is the model's to look at (it is told what failed); the dropdowns left are in its plan.
		return Step{}, false
	}
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceChoose, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
	}
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig
	queue := make([]Action, 0, len(unread))
	for _, item := range unread {
		queue = append(queue, item.choose)
	}
	s.script = &script{queue: queue, made: pr.made}
	slog.Info(fmt.Sprintf("%s: %s could not be read from a picture, so they are set one at a time.", runName(s.id), plainlog.Count(len(unread), "dropdown")))
	step := Step{Status: StatusWorking, Message: s.message, Actions: a.dispatch(s, nil), Number: s.step, Usage: s.usage}
	entry.Status, entry.Message, entry.Actions, entry.Usage = step.Status, step.Message, step.Actions, s.usage
	a.record(s, entry, obs.Screenshot, nil)
	return step, true
}

// leaveToModel leaves the dropdowns no option of which answered to the driving model: it is told which, and
// the next look is a survey, so it sees the page to choose.
func (a *Agent) leaveToModel(s *session, asking []*probeItem) {
	if len(asking) == 0 {
		return
	}
	s.probeUnsure = true
	for _, item := range asking {
		if item.fromType {
			s.notes = append(s.notes, typedListNote(item.choose, item.options))
			continue
		}
		s.notes = append(s.notes, unsureNote(item.choose, item.options))
	}
	s.surveyAgain = true
	slog.Info(fmt.Sprintf("%s: %s showed no sure option in their pictures, so the model chooses on its next look.",
		runName(s.id), plainlog.Count(len(asking), "dropdown")))
}

// typedListItem is the dropdown that typing opened: the extension photographs a list of suggestions that
// appeared under a field as text was typed into it, and names the picture by the type action. The item is
// a choose on that field whose answer is the typed text, already typed, so the picture is read for the
// option that answers and that option is clicked; a list still loading is photographed again after a
// moment, and a picture that shows no list ends it. Nil for a picture of anything else.
func (s *session) typedListItem(snapID string) *probeItem {
	typeID, found := strings.CutSuffix(snapID, typedListSnapSuffix)
	if !found {
		return nil
	}
	typed, ok := s.byID[typeID]
	if !ok || typed.Kind != KindType {
		return nil
	}
	at, ok := s.typedAt[typeID]
	if !ok {
		return nil
	}
	if s.probe == nil {
		s.probe = &probeRun{}
	}
	choose := at
	choose.ID, choose.Kind, choose.Text = typeID, KindChoose, typed.Text
	item := &probeItem{choose: choose, snapID: snapID, typed: true, typedText: typed.Text, fromType: true}
	s.probe.items = append(s.probe.items, item)
	return item
}
