package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A plan whose every action failed, the same way, step after step is a loop the model cannot see out of:
// the page refused the same thing each time and the model planned it again each time. The screen changes
// a little between such steps (a list opens, a cursor moves), so the unchanged-screen count (MaxStale)
// never trips. A recorded Greenhouse run planned the same refused click 33 times over 854 s, with the
// fields below it skipped each time, until the person stopped it; the run now ends as stuck after
// MaxFailedSteps such steps, naming the failure, so the person finishes that part by hand.

// firstFailure is the error of the first action of the batch that failed, when nothing in it succeeded;
// "" when something did, or nothing was planned. An action that reached no control is not a failure of
// the batch (ActionResult.Unreached), and what was skipped after a failure says nothing of its own.
func firstFailure(results []ActionResult) string {
	first := ""
	for _, result := range results {
		if result.OK {
			return ""
		}
		if first == "" && !result.Unreached && result.Error != "" {
			first = result.Error
		}
	}
	return first
}

// failedStreakAfter is how many model steps in a row have ended with every action failing the same way,
// the step that ended with this failure included; 0 when it is not a failure.
func (s *session) failedStreakAfter(failure string) int {
	if failure == "" {
		return 0
	}
	if failure == s.lastFailure {
		return s.failedStreak + 1
	}
	return 1
}

// A click the model plans again at the same point, plan after plan, on a field its own list still shows
// empty, is a click the page did not take: a check box a script on its label toggles straight back (a
// recorded iCIMS run clicked a Signature box dead centre eight times, each reported done, and the box never
// showed ticked), a control under a layer. The click was accurate, so the same click again cannot help.
// The second plan to carry it makes the click once more and photographs the control, close up: when the
// decision model reads a check box or radio button with no mark in it, Space is pressed on it, which goes
// to the control's own keyboard activation and not to a script on its label. The third plan presses Space
// alone on the control, which the clicks left focused (a close-up can still be misread: a run read a box
// with the page's yellow "required" fill as set). The fourth ends the run naming the field, before the
// model drifts to other points.

const (
	// clickRepeatStop is how many plans in a row may carry the same click on a field still empty before the
	// run stops and names it.
	clickRepeatStop = 4
	// clickRepeatSpace is the plan, in that row, that presses Space on the control instead of clicking it.
	clickRepeatSpace = 3
	// checkRetryCropPx is the width and height of the close-up around the point the decision model reads.
	checkRetryCropPx = 240
	// checkRetryCropQuality is the JPEG quality of that close-up.
	checkRetryCropQuality = 90
	// checkRetrySnapSuffix ends the id of the picture taken right after the click made again.
	checkRetrySnapSuffix = "c"
	// clickKeyRoundPx is how close two points are (screenshot pixels) to count as the same.
	clickKeyRoundPx = 6
	// checkRetryWaitMs is how long the page is given to draw the control's state before its picture.
	checkRetryWaitMs = 300
	// askIsCheck and askIsSet are the two questions about the control under the ring.
	askIsCheck = "is_check"
	askIsSet   = "is_set"
)

// clickKey names the point of a click on the page, coarsely, so the same point planned twice reads the same.
func clickKey(action Action) string {
	y := *action.Y
	if action.ScrollTo != nil {
		y += *action.ScrollTo
	}
	return fmt.Sprintf("%d,%d", int(math.Round(*action.X/clickKeyRoundPx)), int(math.Round(y/clickKeyRoundPx)))
}

// repeatedClick finds in the plan a click at a point the plan before also clicked, on a field the model still
// lists as empty, and says for how many plans in a row that has been so (this one included); nil when none.
// It also remembers this plan's clicks for the next. The session is locked.
func (s *session) repeatedClick(planned []Action, obs Observation) (*Action, int) {
	keys := map[string]string{}
	repeats := map[string]int{}
	empty := s.emptyFieldsOn(obs.URL)
	var found *Action
	most := 0
	for i := range planned {
		action := &planned[i]
		if action.Kind != KindClick || action.X == nil || action.Y == nil {
			continue
		}
		key := clickKey(*action)
		keys[key] = action.Label
		if _, before := s.lastClickKeys[key]; !before || !onEmptyField(action.Label, empty) {
			continue
		}
		count := s.clickRepeats[key] + 1
		if count < 2 {
			count = 2
		}
		repeats[key] = count
		if count > most {
			found, most = action, count
		}
	}
	s.lastClickKeys, s.clickRepeats = keys, repeats
	return found, most
}

// onEmptyField is whether a click's label names a field the model still lists as empty.
func onEmptyField(label string, empty []string) bool {
	label = strings.TrimSpace(label)
	if label == "" {
		return false
	}
	for _, field := range empty {
		if labelsAgree(label, field) || labelsAgree(field, label) {
			return true
		}
	}
	return false
}

// withCheckRetry carries out the click made again with a picture right after it, so the agent can see
// whether the control took it (answerCheckRetry); or, the time after, Space on the control the clicks left
// focused, with the same picture. The session is locked.
func (s *session) withCheckRetry(actions []Action) []Action {
	id, space := s.checkRetry, s.checkRetrySpace
	s.checkRetry, s.checkRetrySpace, s.checkRetryPressed = "", false, space
	if id == "" {
		return actions
	}
	var out []Action
	for _, action := range actions {
		if action.ID != id {
			out = append(out, action)
			continue
		}
		// The click first in either case: it gives the control focus (a frame of another origin lets nothing
		// else reach it). Then Space, which a page's label script cannot toggle back.
		out = append(out, action)
		if space {
			out = append(out,
				Action{ID: id + "p", Kind: KindWait, Ms: checkRetryWaitMs, Zone: action.Zone},
				Action{ID: id + "k", Kind: KindKey, Keys: "Space", Zone: action.Zone},
			)
		}
		out = append(out,
			Action{ID: id + "w", Kind: KindWait, Ms: checkRetryWaitMs, Zone: action.Zone},
			Action{ID: id + checkRetrySnapSuffix, Kind: KindSnap, Zone: action.Zone},
		)
	}
	return out
}

// closeUp is the part of a screenshot around a point, as JPEG, with nothing drawn on it: a check box is a
// dozen pixels wide, too small to read its mark on a whole screen, and the usual marker (a ring with a dot
// at the point) would put a red dot inside the box, which a recorded run's decision model read as the mark
// itself, four times over. The control is the one at the centre of the picture.
func closeUp(dataURL string, x, y float64) ([]byte, error) {
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return nil, fmt.Errorf("the screenshot is not a data URL")
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil {
		return nil, err
	}
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	sub, ok := img.(interface {
		SubImage(image.Rectangle) image.Image
	})
	if !ok {
		return nil, fmt.Errorf("the picture cannot be cropped")
	}
	half := checkRetryCropPx / 2
	rect := image.Rect(int(x)-half, int(y)-half, int(x)+half, int(y)+half).Intersect(img.Bounds())
	if rect.Empty() {
		return nil, fmt.Errorf("the point is outside the picture")
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, sub.SubImage(rect), &jpeg.Options{Quality: checkRetryCropQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// answerCheckRetry reads the picture taken after a click made again: with the point ringed, the decision
// model says whether the control there is a check box or radio button and whether it shows as set. One that
// is not is pressed with Space. ok is false for a picture of anything else. The session is locked.
func (a *Agent) answerCheckRetry(ctx context.Context, s *session, upload ShotUpload) (then []Action, ok bool) {
	id, found := strings.CutSuffix(upload.ID, checkRetrySnapSuffix)
	if !found {
		return nil, false
	}
	click := s.checkRetryClick
	if click.ID != id || click.Kind != KindClick || click.X == nil || click.Y == nil {
		return nil, false
	}
	// The point on this picture: the plan measured it on a screen scrolled to ScrollTo.
	ringed := click
	y := *click.Y
	if click.ScrollTo != nil {
		y += *click.ScrollTo - upload.ScrollY
	}
	ringed.Y = &y
	started := time.Now()
	picture, err := closeUp(upload.Screenshot, *ringed.X, *ringed.Y)
	if err != nil {
		slog.Warn(runName(s.id)+": the control clicked again could not be cut out of its picture, so it is left to the next look.", plainlog.ErrorKey, err)
		return nil, true
	}
	a.keepCloseUp(s, upload.ID, picture)
	questions := map[string]decide.Question{
		askIsCheck: decide.YesNo("Is the control at the exact centre of this picture a check box or a radio button: a small square or round box that takes a tick mark or a dot when set?"),
		askIsSet: decide.YesNo("Is a mark drawn inside that box at the centre: a tick or check mark in a square, or a dot in a circle? " +
			"A coloured, yellow or highlighted background, a border or an outline is not a mark. Answer no unless the mark itself is visible inside the box."),
	}
	state := []decide.Part{
		decide.Text(fmt.Sprintf("A close-up of a web page, %d pixels square, taken right after a click at its exact centre.", checkRetryCropPx)),
		decide.Image("data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(picture)),
	}
	response, err := a.newScreen(s.keys()).Decide(ctx, decide.Request{State: state, Questions: questions})
	call := verdict{response: response, prompt: fmt.Sprintf("the control clicked again at %s: a check box, and set", at(click))}.call(err)
	if call.LatencyMs == 0 {
		call.LatencyMs = time.Since(started).Milliseconds()
	}
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	s.reviews.calls = append(s.reviews.calls, call)
	if err != nil {
		slog.Warn(runName(s.id)+": could not read the control clicked again, so it is left to the next look.", plainlog.ErrorKey, err)
		return nil, true
	}
	isCheck, isSet := response.Answers[askIsCheck], response.Answers[askIsSet]
	if isCheck.Noul == nil || isSet.Noul == nil || *isCheck.Noul < likely || *isSet.Noul >= likely {
		return nil, true
	}
	if s.checkRetryPressed {
		// Space was just pressed on it and the box still shows no mark: the next look decides.
		s.notes = append(s.notes, fmt.Sprintf("Acorn pressed Space on %q at %s instead of clicking it again, and the box still showed no mark in its close-up; look at it on the survey.", click.Label, at(click)))
		return nil, true
	}
	s.notes = append(s.notes, fmt.Sprintf("Your click on %q at %s was made again and the box still showed no mark in its close-up, so Acorn pressed Space on it (a page can toggle a box back when it is clicked); look at it on the survey.", click.Label, at(click)))
	return []Action{{ID: id + "s", Kind: KindKey, Keys: "Space", Zone: click.Zone}}, true
}

// keepCloseUp writes the close-up to the trace beside the entry that follows, so a misread can be seen.
func (a *Agent) keepCloseUp(s *session, snapID string, picture []byte) {
	if !a.trace.enabled() {
		return
	}
	name := fmt.Sprintf("%03d.retry-%s.jpg", s.seq, snapID)
	if err := a.trace.writeFiles(s.id, []traceEntryFile{{name: name, data: picture, image: true}}); err != nil {
		slog.Warn(runName(s.id)+": the close-up of a control clicked again could not be saved to the trace.", plainlog.ErrorKey, err)
	}
}
