package agent

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // a screenshot may be a PNG
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A fast-fill run plans a whole page at once and carries the plan out zone by zone: a zone is the
// actions whose points were measured on one screen of the survey. The extension takes a photo when
// the last action of a zone is done, and the agent keeps a small crop of the survey around every
// target (its anchor), so that when the page moves a target can be found again (docs 19.4m).

// Shape of an anchor: a crop of the survey screen around the target. It reaches well above the
// point because a field's label sits there and stays as it is when the field is filled, where the
// field itself changes.
const (
	// anchorWidth is the crop's width in screenshot pixels, centred on the point and clipped.
	anchorWidth = 360
	// anchorAbove and anchorBelow are how far the crop reaches above and below the point.
	anchorAbove = 100
	anchorBelow = 24
	// anchorQuality is the JPEG quality of a crop.
	anchorQuality = 70
	// maxZoneShots bounds the photos one batch of actions may send back.
	maxZoneShots = maxSurveyScreens
)

// anchor is what a target looked like on the survey: where it was and a crop around it.
type anchor struct {
	// Zone is the survey screen (from 1) the point was measured on; 0 for a single screenshot.
	Zone int
	// ScrollY is where the page was scrolled to on that screen, in screenshot pixels.
	ScrollY float64
	// Point is the target in the screenshot's pixels and Rect the crop's place in it.
	Point image.Point
	Rect  image.Rectangle
	// JPEG is the crop.
	JPEG []byte
}

// isPointAction is whether an action aims at a point on the screen.
func isPointAction(action Action) bool {
	switch action.Kind {
	case KindClick, KindDoubleClick, KindTripleClick, KindRightClick, KindHover, KindUpload, KindChoose:
		return action.X != nil && action.Y != nil
	}
	return false
}

// inheritZones gives the actions without a point (typing, keys, scrolls, waits) the zone of the
// action before them, and the ones before the first point the first zone. It changes nothing when
// no action has a zone.
func inheritZones(actions []Action) []Action {
	first := 0
	for _, action := range actions {
		if action.Zone > 0 {
			first = action.Zone
			break
		}
	}
	if first == 0 {
		return actions
	}
	current := first
	for i := range actions {
		if actions[i].Zone > 0 {
			current = actions[i].Zone
			continue
		}
		actions[i].Zone = current
	}
	return actions
}

// zoneRun is the actions of one zone that follow each other in a plan.
type zoneRun struct {
	Zone    int
	Actions []Action
}

// zoneRuns cuts a plan where its zone changes. A plan with no zones is one run of zone 0.
func zoneRuns(actions []Action) []zoneRun {
	var runs []zoneRun
	for _, action := range actions {
		if n := len(runs); n > 0 && runs[n-1].Zone == action.Zone {
			runs[n-1].Actions = append(runs[n-1].Actions, action)
			continue
		}
		runs = append(runs, zoneRun{Zone: action.Zone, Actions: []Action{action}})
	}
	return runs
}

// buildAnchors crops the survey around every point action of a plan, by action id. A single
// screenshot (no survey) is its own one screen. An action whose screen cannot be read has no
// anchor, and is acted on where the model put it.
func buildAnchors(actions []Action, obs Observation) map[string]anchor {
	out := map[string]anchor{}
	decoded := map[int]image.Image{}
	for _, action := range actions {
		if !isPointAction(action) {
			continue
		}
		screenshot, scrollY := obs.Screenshot, obs.Viewport.ScrollY
		if action.Zone >= 1 && action.Zone <= len(obs.Survey) {
			screenshot, scrollY = obs.Survey[action.Zone-1].Screenshot, obs.Survey[action.Zone-1].ScrollY
		}
		img, ok := decoded[action.Zone]
		if !ok {
			raw, readable := decodeDataURL(screenshot)
			if !readable {
				continue
			}
			var err error
			if img, _, err = image.Decode(bytes.NewReader(raw)); err != nil {
				continue
			}
			decoded[action.Zone] = img
		}
		point := image.Pt(int(*action.X), int(*action.Y))
		crop, encoded, ok := cropAround(img, point)
		if !ok {
			continue
		}
		out[action.ID] = anchor{Zone: action.Zone, ScrollY: scrollY, Point: point, Rect: crop, JPEG: encoded}
	}
	return out
}

// cropAround is the crop of img around a point (anchorWidth wide, anchorAbove above the point and
// anchorBelow below, clipped to the image) and its JPEG.
func cropAround(img image.Image, point image.Point) (image.Rectangle, []byte, bool) {
	bounds := img.Bounds()
	rect := image.Rect(point.X-anchorWidth/2, point.Y-anchorAbove, point.X+anchorWidth/2, point.Y+anchorBelow).Intersect(bounds)
	if rect.Empty() {
		return image.Rectangle{}, nil, false
	}
	sub, ok := img.(interface {
		SubImage(image.Rectangle) image.Image
	})
	if !ok {
		return image.Rectangle{}, nil, false
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, sub.SubImage(rect), &jpeg.Options{Quality: anchorQuality}); err != nil {
		return image.Rectangle{}, nil, false
	}
	return rect, buf.Bytes(), true
}

// acceptZoneShots keeps the photos of an observation that are usable: an image the size of the
// viewport, at most maxZoneShots of them. A photo that is not is dropped, not a reason to refuse
// the look: the run goes on and the whole page is looked at again after the plan.
func acceptZoneShots(obs Observation) []ZoneShot {
	var kept []ZoneShot
	for _, shot := range obs.ZoneShots {
		if len(kept) == maxZoneShots {
			break
		}
		width, height, err := imageSize(shot.Screenshot)
		if err != nil || abs(width-obs.Viewport.Width) > sizeTolerance || abs(height-obs.Viewport.Height) > sizeTolerance {
			continue
		}
		kept = append(kept, shot)
	}
	return kept
}

// keepZoneShots takes the photos the extension sent with this look, writes them to the trace
// beside the entry that answers it, and keeps them for the checks that read them.
func (a *Agent) keepZoneShots(s *session, obs Observation) {
	s.zones = acceptZoneShots(obs)
	if len(s.zones) == 0 {
		return
	}
	zones := make([]string, len(s.zones))
	files := make([]traceEntryFile, 0, len(s.zones))
	for i, shot := range s.zones {
		zones[i] = fmt.Sprint(shot.Zone)
		if raw, ok := decodeDataURL(shot.Screenshot); ok {
			files = append(files, traceEntryFile{name: fmt.Sprintf("%03d.zone%d.jpg", s.seq, shot.Zone), data: raw, image: true})
		}
	}
	if a.trace.enabled() {
		if err := a.trace.writeFiles(s.id, files); err != nil {
			slog.Warn("The photos of the zones could not be saved to the trace: "+runName(s.id)+".", plainlog.ErrorKey, err)
		}
	}
	slog.Info(fmt.Sprintf("%s: got %s from the plan just carried out (%s).", runName(s.id),
		plainlog.Count(len(s.zones), "zone photo"), "zone "+strings.Join(zones, ", ")))
}
