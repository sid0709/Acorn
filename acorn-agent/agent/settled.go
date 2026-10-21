package agent

import (
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A page is looked at more than once, and most of it does not change: a job description, a heading,
// a part that is filled and right. When the model has looked at a screen of a survey and says it will
// not need to come back to it, the screen is settled. Settled parts are painted blue on a minimap of
// the page, are not shown to the model again, and are not scrolled to and photographed again in the
// next survey. They stay settled while the page is the same page and as tall as it was.

// settledHeightTolerance is how much taller or shorter than when a part was settled the page may be
// (screenshot pixels) before what was settled is forgotten: a page that grew may have moved it.
const settledHeightTolerance = 12

// settledState is what is settled on the page the run is on.
type settledState struct {
	// URL is the page it is about; PageHeight its height (screenshot pixels) when the parts were settled.
	URL        string
	PageHeight float64
	Spans      []Span
	// Fence is where the plan being carried out first acts on the page (see SettledMap).
	Fence float64
	// changed is set when the spans changed since they were last sent to the extension.
	changed bool
	// look is the look whose move of the form was last placed (Observation.Look): a step sent again
	// carries the same look, and its move is not placed twice.
	look string
}

// mergeSettled is the spans in order, with those that overlap or touch made one.
func mergeSettled(spans []Span) []Span {
	if len(spans) == 0 {
		return nil
	}
	sorted := append([]Span(nil), spans...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].From < sorted[j].From })
	out := []Span{sorted[0]}
	for _, span := range sorted[1:] {
		last := &out[len(out)-1]
		if span.From <= last.To+1 {
			last.To = max(last.To, span.To)
			continue
		}
		out = append(out, span)
	}
	return out
}

// forgetSettledIfStale drops what was settled when the look is of another page. When the page is at
// another height, the stretches follow the controls: Observation.Layout is where they moved, and each
// stretch moves with the controls it lies among. No control moved and the page grew: what was added is
// at the bottom, so the coordinates still hold. The page shrank and nothing moved: the bottom was cut.
func (s *session) forgetSettledIfStale(obs Observation) {
	if len(s.settled.Spans) == 0 {
		return
	}
	if s.settled.URL != withoutFragment(obs.URL) {
		s.settled = settledState{changed: true}
		slog.Info(runName(s.id) + ": what was settled on the page is forgotten: the page is another page.")
		return
	}
	layout := obs.Layout
	if obs.Look != "" && obs.Look == s.settled.look {
		layout = nil // this look's move was placed when the step first came; the step was sent again
	}
	sameHeight := abs(int(obs.Viewport.PageHeight)-int(s.settled.PageHeight)) <= settledHeightTolerance
	if sameHeight && len(layout) == 0 {
		return
	}
	spans := s.settled.Spans
	switch {
	case len(layout) > 0:
		spans = placeSettled(spans, layout)
		s.settled.look = obs.Look
		slog.Info(fmt.Sprintf("%s: the form moved (%s); %s stay settled.",
			runName(s.id), layoutLine(layout), plainlog.Count(len(spans), "stretch")))
	case obs.Viewport.PageHeight+float64(settledHeightTolerance) < s.settled.PageHeight:
		spans = cropSettled(spans, obs.Viewport.PageHeight)
		slog.Info(fmt.Sprintf("%s: the page is %.0f px tall now and was %.0f px; the bottom was cut, %s stay settled.",
			runName(s.id), obs.Viewport.PageHeight, s.settled.PageHeight, plainlog.Count(len(spans), "stretch")))
	default:
		slog.Info(fmt.Sprintf("%s: the page is %.0f px tall now and was %.0f px; nothing on it moved, so what was settled stays where it was.",
			runName(s.id), obs.Viewport.PageHeight, s.settled.PageHeight))
	}
	s.settled.Spans, s.settled.PageHeight, s.settled.changed = spans, obs.Viewport.PageHeight, true
}

// layoutLine says where the form moved, for the run's story: "at 3558 px by +14 px".
func layoutLine(moves []LayoutMove) string {
	parts := make([]string, 0, len(moves))
	for _, move := range moves {
		parts = append(parts, fmt.Sprintf("at %.0f px by %+.0f px", move.At, move.Dy))
	}
	return strings.Join(parts, ", ")
}

// settledRun is a stretch of the old page whose controls moved together, by Dy.
type settledRun struct{ from, to, dy float64 }

// cleanMoves is the moves in order down the page, each beginning no earlier than the one before ended,
// without any that is not a number.
func cleanMoves(moves []LayoutMove) []LayoutMove {
	var out []LayoutMove
	for _, move := range moves {
		if math.IsNaN(move.From+move.At+move.Dy) || math.IsInf(move.From+move.At+move.Dy, 0) {
			continue
		}
		out = append(out, move)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At < out[j].At })
	floor := 0.0
	for i := range out {
		out[i].From = math.Min(math.Max(out[i].From, floor), out[i].At)
		floor = out[i].At
	}
	return out
}

// runsOf cuts the old page where the form moved. Above the first move nothing moved; each move starts
// a run at its At by its Dy, and ends the run before it at its From. What lies between From and At is in
// no run: something appeared there, or went, so nothing there is known to be as it was.
func runsOf(moves []LayoutMove) []settledRun {
	var runs []settledRun
	start, dy := 0.0, 0.0
	for _, move := range moves {
		if move.From > start {
			runs = append(runs, settledRun{from: start, to: move.From, dy: dy})
		}
		start, dy = move.At, move.Dy
	}
	return append(runs, settledRun{from: start, to: math.Inf(1), dy: dy})
}

// placeSettled moves stretches with the form: each piece of a stretch that lies in a run of the old page
// goes where the run went. A stretch the gap of a move cuts is cut there, so what appeared in the gap is
// not settled, and a place that two pieces both land on (the form shrank over it) is not settled either.
func placeSettled(spans []Span, moves []LayoutMove) []Span {
	runs := runsOf(cleanMoves(moves))
	var pieces []Span
	for _, span := range spans {
		for _, run := range runs {
			from, to := math.Max(span.From, run.from), math.Min(span.To, run.to)
			if to-from <= 1 {
				continue
			}
			from, to = math.Max(from+run.dy, 0), math.Max(to+run.dy, 0)
			if to-from > 1 {
				pieces = append(pieces, Span{From: from, To: to})
			}
		}
	}
	return singlyCovered(pieces)
}

// singlyCovered is the parts of the line that exactly one of the pieces covers, in order, with those that
// touch made one.
func singlyCovered(pieces []Span) []Span {
	var edges []float64
	for _, piece := range pieces {
		edges = append(edges, piece.From, piece.To)
	}
	sort.Float64s(edges)
	var kept []Span
	for i := 0; i+1 < len(edges); i++ {
		lo, hi := edges[i], edges[i+1]
		if hi-lo <= 0 {
			continue
		}
		covering := 0
		for _, piece := range pieces {
			if piece.From <= lo && piece.To >= hi {
				covering++
			}
		}
		if covering == 1 {
			kept = append(kept, Span{From: lo, To: hi})
		}
	}
	out := mergeSettled(kept)
	filtered := out[:0]
	for _, span := range out {
		if span.To-span.From > 1 {
			filtered = append(filtered, span)
		}
	}
	return filtered
}

// cropSettled drops the part of each stretch past height, and stretches that start there.
func cropSettled(spans []Span, height float64) []Span {
	var out []Span
	for _, span := range spans {
		if span.From >= height-1 {
			continue
		}
		to := min(span.To, height)
		if to-span.From > 1 {
			out = append(out, Span{From: span.From, To: to})
		}
	}
	return out
}

// fenceOf is how far down the page a plan leaves things as they are: the page position (screenshot
// pixels) of the first point it acts on. A plan that acts on no point leaves the whole page as it is.
func fenceOf(planned []Action, obs Observation) float64 {
	fence := obs.Viewport.PageHeight
	for _, action := range planned {
		if !isPointAction(action) {
			continue
		}
		top := obs.Viewport.ScrollY
		if action.ScrollTo != nil {
			top = *action.ScrollTo
		}
		fence = min(fence, top+*action.Y)
	}
	return fence
}

// setFence records where the plan about to be carried out first acts on the page, and tells the
// extension when that changed what it knows.
func (s *session) setFence(planned []Action, obs Observation) {
	fence := fenceOf(planned, obs)
	if fence != s.settled.Fence {
		s.settled.Fence, s.settled.changed = fence, true
	}
}

// touchedScreens are the screens of a survey the plan acts on: an action is on the screen it is
// pinned to. A screen with an action on it is not settled by the same answer: it is looked at again first.
func touchedScreens(planned []Action, obs Observation) map[int]bool {
	touched := map[int]bool{}
	for _, action := range planned {
		if action.ScrollTo == nil {
			continue
		}
		for i, screen := range obs.Survey {
			if abs(int(screen.ScrollY)-int(*action.ScrollTo)) <= 1 {
				touched[i+1] = true
			}
		}
	}
	return touched
}

// markSettled records the screens of the survey the model said it will not come back to, except those
// the plan acts on. claimed are the screens the plan acted on before any point was refused (a screen
// whose point was refused still has something to fill). It reports how many screens it settled.
func (s *session) markSettled(obs Observation, screens []int, planned []Action, claimed map[int]bool) int {
	if len(obs.Survey) == 0 || len(screens) == 0 {
		return 0
	}
	touched := touchedScreens(planned, obs)
	var added []Span
	for _, n := range screens {
		if n < 1 || n > len(obs.Survey) || touched[n] || claimed[n] {
			continue
		}
		from := obs.Survey[n-1].ScrollY
		added = append(added, Span{From: from, To: from + float64(obs.Viewport.Height)})
	}
	if len(added) == 0 {
		return 0
	}
	s.settled.URL, s.settled.PageHeight = withoutFragment(obs.URL), obs.Viewport.PageHeight
	s.settled.Spans = mergeSettled(append(s.settled.Spans, added...))
	s.settled.changed = true
	return len(added)
}

// takeSettledMap is what the extension is told when the settled parts changed, and forgets that it
// changed. An empty map tells it that nothing is settled any more.
func (s *session) takeSettledMap() *SettledMap {
	if !s.settled.changed {
		return nil
	}
	s.settled.changed = false
	return &SettledMap{PageHeight: s.settled.PageHeight, Fence: s.settled.Fence, Spans: append([]Span{}, s.settled.Spans...)}
}

// settledNote tells the model what a survey leaves out.
func (s *session) settledNote() string {
	if len(s.settled.Spans) == 0 {
		return ""
	}
	parts := make([]string, len(s.settled.Spans))
	for i, span := range s.settled.Spans {
		parts[i] = fmt.Sprintf("%.0f to %.0f px", span.From, span.To)
	}
	return fmt.Sprintf("You settled these parts of the page and they are not shown again (blue on the page's map): %s. "+
		"Everything else is in the survey. List in \"settled\" the screens you will not need to come back to.", strings.Join(parts, "; "))
}

// settledLine is a sentence about how many screens the model settled, for the run's story.
func settledLine(id string, screens int, total []Span) string {
	return fmt.Sprintf("%s: %s of the page settled, %s of it in all.", runName(id), plainlog.Count(screens, "screen"), plainlog.Count(len(total), "stretch"))
}

// seeSurvey records that the model has looked at every screen of a survey, and at every settled part:
// the page's reach (coverage.go) is told to the model as what it has not looked at, and a survey it
// was shown, or a part it settled, is looked at.
func (s *session) seeSurvey(obs Observation) {
	for _, screen := range obs.Survey {
		view := obs.Viewport
		view.ScrollY = screen.ScrollY
		s.cover.see(obs.URL, view)
	}
	for _, span := range s.settled.Spans {
		view := obs.Viewport
		view.ScrollY, view.Height = span.From, int(span.To-span.From)
		s.cover.see(obs.URL, view)
	}
}

// blueScrollNote tells the model why a scroll it planned was not made.
const blueScrollNote = "You planned a scroll to a part of the page you settled (blue on the page's map): you will not need to come back to it, so Acorn did not go there."

// withoutBlueScrolls is the plan without the scrolls that would end with the window wholly inside a
// part of the page the model settled: it never goes back into one. A scroll is judged from where the
// window is when it is made, which is where the plan's earlier scrolls and its pinned points put it.
// It says how many it dropped.
func (s *session) withoutBlueScrolls(planned []Action, obs Observation) ([]Action, int) {
	if len(s.settled.Spans) == 0 {
		return planned, 0
	}
	height := float64(obs.Viewport.Height)
	last := max(0, obs.Viewport.PageHeight-height)
	at := obs.Viewport.ScrollY
	var kept []Action
	dropped := 0
	for _, action := range planned {
		if action.ScrollTo != nil {
			at = *action.ScrollTo
		}
		if action.Kind == KindScroll {
			target := min(max(at+action.DY, 0), last)
			if s.inSettled(target, height) {
				dropped++
				continue
			}
			at = target
		}
		kept = append(kept, action)
	}
	return kept, dropped
}

// inSettled is whether the window of the given height, with its top at y, lies wholly in a settled stretch.
func (s *session) inSettled(y, height float64) bool {
	for _, span := range s.settled.Spans {
		if span.From <= y+1 && span.To >= y+height-1 {
			return true
		}
	}
	return false
}
