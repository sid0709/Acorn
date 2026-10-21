package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// Dropdowns that the page draws itself are set one at a time by a script (choose.go): open it, look,
// pick, and only then the next one, a round trip to the agent for every look. A fast-fill run probes them
// together instead. For every dropdown of a run of them the extension opens it, waits a moment and takes a
// picture (a snap action), and closes it, all in one batch with no look between; the agent reads the
// pictures side by side (listread.go), and the next batch picks the answer in every dropdown. Each picture
// is read as the applicant would read it: the decision model says whether the box already shows the answer
// (then nothing more is done to it), whether a list is open, and which option answers. Where the page says
// it drew each option, the options in view are numbered on the picture and the pick clicks the box the
// number was drawn on; else the option is counted from the list's first one.
//
//   - a good option in view is picked: by its number, or by its place among the first options;
//   - a click that opened nothing is made again a little above and below, all tries photographed in one
//     batch, and the first try whose picture shows a list open (or the answer already in the box) is kept;
//   - a list that is open but shows no answer, or none that can be counted, is the one case for typing: it is
//     opened again with the start of the answer typed so the list narrows (or loads), and photographed again,
//     still in this batch, and closed after; a list that loads from a server is given a longer wait once;
//   - a native list (the browser draws its popup outside the page, so no picture shows it) reports its
//     options as text, and the answer is picked from them;
//   - a dropdown that still shows no answer after that is left to the driving model, which sees the page and
//     chooses on its next look, while the rest of the run goes on and the click that sends the page is held
//     back; one whose picture never came goes back to the script (choose.go).
//
// Nothing the page reports of its controls (which has focus, what a box holds, what the options are called)
// decides any of this: only where the options are drawn. Nothing else checks a pick afterwards but the photo
// of its zone (review.go) and the survey that follows the plan.

const (
	// probeOpenWaitMs is how long an opened list is given to draw before its picture is taken.
	probeOpenWaitMs = 500
	// probeTypedWaitMs is how long a list is given to narrow, or to load from a server, after the answer is typed.
	probeTypedWaitMs = 800
	// probeTypedRetryWaitMs is how long it is given the one time more it is typed into after a list that showed
	// nothing: a list fetched from a server over a slow line (a recorded run's came after the first wait).
	probeTypedRetryWaitMs = 2500
	// typedMinChars is the least a first part of the answer must have to be typed on its own: a list that
	// searches as one types is narrowed by the start of the answer ("Fresno"), not the whole of it
	// ("Fresno, California, United States"), which a search may not match as a whole.
	typedMinChars = 3
	// probeSelectWaitMs is how long a list is given to draw before the keys that pick from it.
	probeSelectWaitMs = 250
	// directMaxPosition is the furthest down an unnarrowed list an option is picked by its place in a
	// picture: a model counts three options reliably and ten not, so anything further is narrowed by typing
	// first. Options numbered on the picture have no such limit: the number is read, not counted.
	directMaxPosition = 6
	// probeEscape is the key that closes an opened list.
	probeEscape = "Escape"
)

// What a probe is waiting for.
const (
	probeStageOpen   = "open"
	probeStageTyped  = "typed"
	probeStageNudged = "nudged"
)

// probeItem is one dropdown of the run being probed.
type probeItem struct {
	choose Action
	// snapID is the snap action whose picture is this dropdown's; typed is that the picture is of the list
	// after the answer was typed, typedText what was typed (typedAnswer), and retried that it was typed
	// once more with a longer wait, after a list that showed nothing.
	snapID    string
	typed     bool
	typedText string
	retried   bool
	// nudged is that the dropdown was opened again a little lower, after a click that reached nothing;
	// nudges are the tries, one per nudge offset, all in one batch: each its point and the snap of it.
	nudged bool
	nudges []probeNudge
	// What the reading decided: a place in the list, the text of an option of a native list, that the click
	// opened nothing (closed: click again, lower), or that the list needs the answer typed (the rest zero);
	// or that no option answered (unsure), for the driving model; or that the box already shows the answer
	// (done), and nothing more is done to it.
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
}

// probeNudge is one try at opening a dropdown a little above or below the model's point.
type probeNudge struct {
	y      float64
	snapID string
}

// probeRun is the run of the model's actions with dropdowns in it, being carried out.
type probeRun struct {
	// queue is what is left of the run, in order; items the dropdowns waiting on their pictures.
	queue []Action
	items []*probeItem
	stage string
	made  int
	// deferred are the dropdowns that could not be read from a picture: when the others are done they go
	// back to the script with what is left of the run.
	deferred []*probeItem
}

// nextID is a fresh id for an action the agent makes for a dropdown.
func (pr *probeRun) nextID(seq int) string {
	pr.made++
	return fmt.Sprintf("s%d%s%d", seq, choosePrefix, pr.made)
}

// probing is whether fast-fill runs probe their dropdowns together.
func (a *Agent) probing(s *session) bool {
	return s.start.FastFill && a.cfg.ProbeDropdowns && a.checksOn(s)
}

// startProbe begins carrying out a run with dropdowns in it: what comes before the first run of them goes
// as it is, then every dropdown of that run is opened and photographed.
func (a *Agent) startProbe(s *session, actions []Action) []Action {
	s.probe = &probeRun{queue: bottomUp(actions)}
	return a.probeNext(s, nil)
}

// probeNext builds the next batch: prefix, the plan's actions up to the next run of dropdowns, and the
// probe of every dropdown of that run. When none is left the run is over.
func (a *Agent) probeNext(s *session, prefix []Action) []Action {
	pr := s.probe
	batch := append([]Action(nil), prefix...)
	for len(pr.queue) > 0 {
		next := pr.queue[0]
		if next.Kind != KindChoose {
			batch = append(batch, next)
			pr.queue = pr.queue[1:]
			continue
		}
		var items []*probeItem
		for len(pr.queue) > 0 && pr.queue[0].Kind == KindChoose {
			items = append(items, &probeItem{choose: pr.queue[0]})
			pr.queue = pr.queue[1:]
		}
		// The lists are opened and photographed from the top down: that changes nothing on the page, and it
		// ends at the bottom, where the pass that picks in them (from the bottom up) begins.
		for i := len(items) - 1; i >= 0; i-- {
			batch = append(batch, a.probeOpen(s, items[i])...)
		}
		pr.items, pr.stage = items, probeStageOpen
		return batch
	}
	s.probe = nil
	return batch
}

// helper is an action of the agent's own for a dropdown, aimed where the model aimed. It carries the
// dropdown's anchor, so its point is found again if the page changes shape.
func (a *Agent) helper(s *session, choose Action, id string, kind string) Action {
	action := Action{ID: id, Kind: kind}
	if kind == KindClick {
		action.X, action.Y, action.ScrollTo, action.PageHeight = choose.X, choose.Y, choose.ScrollTo, choose.PageHeight
		s.carryAnchor(choose.ID, id)
	}
	return action
}

// probeOpen opens a dropdown, waits for its list to draw, takes its picture and closes it.
func (a *Agent) probeOpen(s *session, item *probeItem) []Action {
	pr := s.probe
	seq := s.seq
	item.snapID = pr.nextID(seq)
	return []Action{
		a.helper(s, item.choose, pr.nextID(seq), KindClick),
		{ID: pr.nextID(seq), Kind: KindWait, Ms: probeOpenWaitMs},
		{ID: item.snapID, Kind: KindSnap},
		{ID: pr.nextID(seq), Kind: KindKey, Keys: probeEscape},
	}
}

// probeTyped opens a dropdown again, types the answer so that the list narrows (or loads), waits, takes
// its picture and closes the list. It is closed because the dropdowns are typed into from the top down, and
// a list left open hangs over the dropdown below it: a recorded run's click on the next dropdown landed on
// an option of the list above and chose it.
func (a *Agent) probeTyped(s *session, item *probeItem) []Action {
	pr := s.probe
	seq := s.seq
	wait := probeTypedWaitMs
	if item.typed {
		// Typed before and the list showed nothing: once more, with time for a list that comes from a server.
		item.retried, wait = true, probeTypedRetryWaitMs
	}
	item.typed, item.typedText, item.snapID = true, typedAnswer(item.choose.Text), pr.nextID(seq)
	return []Action{
		a.helper(s, item.choose, pr.nextID(seq), KindClick),
		{ID: pr.nextID(seq), Kind: KindType, Text: item.typedText},
		{ID: pr.nextID(seq), Kind: KindWait, Ms: wait},
		{ID: item.snapID, Kind: KindSnap},
		{ID: pr.nextID(seq), Kind: KindKey, Keys: probeEscape},
	}
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

// probeNudged opens a dropdown again a little above and below the model's point, after a click that
// reached nothing (the point was on the question's words above the box, or in the gap round it, and a
// person would move onto it), and takes a picture at each try, all in one batch: every try is a look
// fewer than one try a look, and the reading takes the first try that reached the box (readNudges). The
// dropdown's point moves to that try, so the pick that follows clicks where the list opened.
func (a *Agent) probeNudged(s *session, item *probeItem) []Action {
	pr := s.probe
	seq := s.seq
	item.nudged, item.closed, item.nudges = true, false, nil
	var batch []Action
	for _, offset := range nudgeOffsets {
		moved := item.choose
		y := *item.choose.Y + offset
		moved.Y = &y
		try := probeNudge{y: y, snapID: pr.nextID(seq)}
		item.nudges = append(item.nudges, try)
		batch = append(batch,
			a.helper(s, moved, pr.nextID(seq), KindClick),
			Action{ID: pr.nextID(seq), Kind: KindWait, Ms: probeOpenWaitMs},
			Action{ID: try.snapID, Kind: KindSnap},
			Action{ID: pr.nextID(seq), Kind: KindKey, Keys: probeEscape},
		)
	}
	item.snapID = item.nudges[0].snapID
	return batch
}

// apply sets what a reading of a dropdown's picture decided.
func (item *probeItem) apply(read listReading, snap ShotUpload) {
	limit := directMaxPosition
	if read.numbered || item.typed {
		limit = maxOptionPosition
	}
	switch {
	case read.shows && !item.typed:
		item.done = true
	case read.position > 0 && (read.numbered || read.position <= limit):
		item.pick, item.list, item.listScrollY = read.position, nil, snap.ScrollY
		if read.numbered {
			item.list = snap.List
		}
	case !read.open && !item.nudged && !item.typed:
		item.closed = true
	case !item.typed:
		// A list too long to count, not drawn yet, or one that searches as one types: type the start of the
		// answer in this batch and look again.
		item.needs = true
	case !read.open && !item.retried:
		// Typed, and still no list in the picture: once more, with time for a list that loads.
		item.needs = true
	default:
		item.unsure = true
	}
}

// probeSelect picks the answer in a dropdown that was resolved: the list is opened again as it was read
// (typed into the same way when it was narrowed), and the option is clicked where the page drew it; the
// keys that reach it are the fallback when the page did not say where (optionPick). A native list is
// keyed: the browser draws its popup outside the page.
//
// Every action of the pick carries the dropdown's zone, so the extension photographs the zone once its picks
// are done, and the photo's review (review.go) reads whether the box shows the answer.
func (a *Agent) probeSelect(s *session, item *probeItem) []Action {
	pr := s.probe
	seq := s.seq
	open := a.helper(s, item.choose, pr.nextID(seq), KindClick)
	pick := func() Action {
		return optionPick(pr.nextID(seq), item.list, item.pick, item.listScrollY, s.viewport)
	}
	var batch []Action
	switch {
	case item.native != "":
		// A native list matches what is typed to its options as it goes, so the whole text selects that one.
		batch = []Action{open,
			{ID: pr.nextID(seq), Kind: KindType, Text: item.native},
			{ID: pr.nextID(seq), Kind: KindKey, Keys: "Enter"}}
	case item.typed:
		// The same text as narrowed the list that was read, so the pick lands on the same option.
		wait := probeTypedWaitMs
		if item.retried {
			wait = probeTypedRetryWaitMs
		}
		batch = []Action{open,
			{ID: pr.nextID(seq), Kind: KindType, Text: item.typedText},
			{ID: pr.nextID(seq), Kind: KindWait, Ms: wait},
			pick()}
	default:
		batch = []Action{open,
			{ID: pr.nextID(seq), Kind: KindWait, Ms: probeSelectWaitMs},
			pick()}
	}
	if zone := item.choose.Zone; zone > 0 {
		for i := range batch {
			batch[i].Zone = zone
		}
		s.notePicked(zone)
	}
	return batch
}

// reading is what reading one dropdown's pictures made, for the trace and the usage.
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
		index, check, asked, err := a.decideListed(ctx, s, item.choose.Text, options, focusLabel(snap.Focus))
		if index >= 0 && err == nil {
			item.native = options[index]
		}
		if asked {
			out.add(check, err)
		}
		return out
	}
	read, check, err := a.readListPicture(ctx, s, snap.Screenshot, item.choose.Text, chooseLabel(item.choose, nil), snap.List, snap.ScrollY, !item.typed)
	out.add(check, err)
	if err == nil {
		item.apply(read, snap)
	}
	return out
}

// readNudged reads the pictures of a dropdown opened a little above and below the model's point, side by
// side, and keeps the first try whose picture shows a list open or the answer in the box: the dropdown's
// point becomes that try's, so the pick that follows clicks where the list opened. When no try did, the
// first stands, and its reading goes on as before (typed into there).
func (a *Agent) readNudged(ctx context.Context, s *session, item *probeItem, snaps []ShotUpload) reading {
	var out reading
	for i, snap := range snaps {
		if nativeList(snap.Focus) != nil {
			item.nudgeTo(i)
			return a.readOne(ctx, s, item, snap)
		}
	}
	reads := make([]listReading, len(snaps))
	checks := make([]verdict, len(snaps))
	errs := make([]error, len(snaps))
	var wg sync.WaitGroup
	for i, snap := range snaps {
		if snap.Screenshot == "" {
			errs[i] = errNoPicture
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			reads[i], checks[i], errs[i] = a.readListPicture(ctx, s, snap.Screenshot, item.choose.Text, chooseLabel(item.choose, nil), snap.List, snap.ScrollY, !item.typed)
		}()
	}
	wg.Wait()
	chosen := -1
	for i := range snaps {
		if errs[i] == errNoPicture {
			continue
		}
		out.add(checks[i], errs[i])
		if chosen < 0 && errs[i] == nil && (reads[i].open || reads[i].shows) {
			chosen = i
		}
	}
	if chosen < 0 {
		chosen = 0
	}
	item.nudgeTo(chosen)
	if errs[chosen] == nil {
		item.apply(reads[chosen], snaps[chosen])
	}
	return out
}

// errNoPicture is a try of a nudged dropdown whose picture never came.
var errNoPicture = errors.New("the picture of this try did not come")

// nudgeTo makes the n-th try of a nudged dropdown its point.
func (item *probeItem) nudgeTo(n int) {
	moved := item.choose
	y := item.nudges[n].y
	moved.Y = &y
	item.choose, item.snapID = moved, item.nudges[n].snapID
}

// readProbes reads the picture of every dropdown being probed, side by side, and says what was decided
// for each. It also returns the decisions as model calls for the trace. The session is locked.
func (a *Agent) readProbes(ctx context.Context, s *session) []modelCall {
	pr := s.probe
	readings := make([]reading, len(pr.items))
	snaps := make([][]ShotUpload, len(pr.items))
	for i, item := range pr.items {
		// What the last reading asked for was done in this batch; this reading decides afresh.
		item.closed, item.needs = false, false
		if len(item.nudges) > 0 {
			for _, try := range item.nudges {
				snaps[i] = append(snaps[i], s.snaps[try.snapID])
				delete(s.snaps, try.snapID)
			}
			continue
		}
		snaps[i] = []ShotUpload{s.snaps[item.snapID]}
		delete(s.snaps, item.snapID)
	}
	var wg sync.WaitGroup
	for i, item := range pr.items {
		if len(item.nudges) == 0 && snaps[i][0].Screenshot == "" {
			continue // no picture came: the script takes this dropdown
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if len(item.nudges) > 0 {
				readings[i] = a.readNudged(ctx, s, item, snaps[i])
				item.nudges = nil
				return
			}
			readings[i] = a.readOne(ctx, s, item, snaps[i][0])
		}()
	}
	wg.Wait()
	var calls []modelCall
	for _, one := range readings {
		if one.failure != nil {
			slog.Warn(runName(s.id)+": could not read the list of a dropdown.", plainlog.ErrorKey, one.failure)
		}
		s.usage.Checks += len(one.calls)
		s.usage.CheckCost += one.cost
		s.usage.Cost += one.cost
		calls = append(calls, one.calls...)
	}
	return calls
}

// resolved is whether a dropdown's reading says how to pick its answer.
func (item *probeItem) resolved() bool { return item.pick > 0 || item.native != "" }

// continueProbe carries on a run whose dropdowns were just probed: it reads the pictures, and sends the
// batch that picks in the dropdowns that are resolved and probes again, with the answer typed, those that
// need it. Dropdowns no option of which answered are left to the driving model, told their options; those
// that could not be read go back to the script when the rest are done. It reports false when the model
// must look instead.
func (a *Agent) continueProbe(ctx context.Context, s *session, obs Observation, results []ActionResult, sig []uint8) (Step, bool) {
	pr := s.probe
	if pr == nil || len(pr.items) == 0 {
		return Step{}, false
	}
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceChoose, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
	}
	if failed := failedResults(obs.Results); failed != "" {
		s.probe = nil
		a.abandon(s, "The last actions failed: "+failed+".")
		return Step{}, false
	}
	calls := a.readProbes(ctx, s)
	entry.Usage = s.usage
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig

	var batch []Action
	var again, asking []*probeItem
	for _, item := range pr.items {
		switch {
		case item.done:
			slog.Info(fmt.Sprintf("%s: a dropdown already shows its answer (%s), so nothing more is done to it.", runName(s.id), chooseLabel(item.choose, nil)))
		case item.resolved():
			batch = append(batch, a.probeSelect(s, item)...)
		case item.closed || item.needs:
			again = append(again, item)
		case item.unsure:
			asking = append(asking, item)
		default:
			pr.deferred = append(pr.deferred, item)
		}
	}
	if len(again) > 0 {
		// Probed again, after the picks (which end at the top of the run), from the top down: opened a little
		// lower when the click reached nothing, else with the answer typed.
		stage := probeStageNudged
		for i := len(again) - 1; i >= 0; i-- {
			if again[i].closed {
				batch = append(batch, a.probeNudged(s, again[i])...)
				continue
			}
			batch = append(batch, a.probeTyped(s, again[i])...)
			stage = probeStageTyped
		}
		pr.items, pr.stage = again, stage
		return a.probeStep(s, entry, obs, batch, calls, nil), true
	}
	dropped := a.leaveToModel(s, asking)
	if len(pr.deferred) > 0 {
		return a.handBack(s, entry, obs, batch, calls, dropped), true
	}
	return a.probeStep(s, entry, obs, a.probeNext(s, batch), calls, dropped), true
}

// leaveToModel leaves the dropdowns no option of which answered to the driving model: it is told which, the
// next look is a survey, and the click that sends the page is held back (the page is
// not complete) while the rest of the run goes on. It says what was dropped, for the log.
func (a *Agent) leaveToModel(s *session, asking []*probeItem) []string {
	if len(asking) == 0 {
		return nil
	}
	pr := s.probe
	for _, item := range asking {
		s.notes = append(s.notes, unsureNote(item.choose, nil))
	}
	s.surveyAgain = true
	var dropped []string
	kept, held := withoutCommits(pr.queue)
	if len(held) > 0 {
		pr.queue = kept
		s.notes = append(s.notes, commitHeldNote(held, len(asking)))
		dropped = append(dropped, fmt.Sprintf("the click that sends the page was held back: %s had no sure option", plainlog.Count(len(asking), "dropdown")))
	}
	slog.Info(fmt.Sprintf("%s: %s showed no sure option in their pictures, so the model chooses on its next look.",
		runName(s.id), plainlog.Count(len(asking), "dropdown")))
	return dropped
}

// handBack gives the dropdowns that could not be read from a picture back to the script, with the rest of
// the run: it sets them one at a time and has ways of its own when a list does not answer (clicking again a
// little lower, clearing what was typed, telling the model).
func (a *Agent) handBack(s *session, entry stepTrace, obs Observation, batch []Action, calls []modelCall, dropped []string) Step {
	pr := s.probe
	queue := make([]Action, 0, len(pr.deferred)+len(pr.queue))
	for _, item := range pr.deferred {
		queue = append(queue, item.choose)
	}
	queue = append(queue, pr.queue...)
	s.script = &script{queue: queue, made: pr.made}
	s.probe = nil
	slog.Info(fmt.Sprintf("%s: %s could not be read from a picture, so they are set one at a time.", runName(s.id), plainlog.Count(len(pr.deferred), "dropdown")))
	return a.probeStep(s, entry, obs, a.dispatch(s, batch), calls, dropped)
}

// probeStep sends a batch of a probed run.
func (a *Agent) probeStep(s *session, entry stepTrace, obs Observation, batch []Action, calls []modelCall, dropped []string) Step {
	step := Step{Status: StatusWorking, Message: s.message, Actions: batch, Number: s.step, Usage: s.usage, Dropped: dropped}
	// The run's last batch is followed by a survey of the whole page, to finish and to check what is left;
	// so is an empty last batch when a dropdown was left to the model, which must see the page to choose.
	step.Survey = s.probe == nil && s.script == nil && (len(batch) > 0 || s.surveyAgain)
	if step.Survey {
		s.surveyAgain = false
	}
	entry.Usage = s.usage
	entry.Status, entry.Message, entry.Actions, entry.Dropped = step.Status, step.Message, step.Actions, dropped
	a.record(s, entry, obs.Screenshot, calls)
	return step
}
