package agent

import (
	"fmt"
	"log/slog"
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
	// changed is set when the spans changed since they were last sent to the extension.
	changed bool
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

// forgetSettledIfStale drops what was settled when the look is of another page, or of the page at
// another height.
func (s *session) forgetSettledIfStale(obs Observation) {
	if len(s.settled.Spans) == 0 {
		return
	}
	reason := ""
	switch {
	case s.settled.URL != withoutFragment(obs.URL):
		reason = "the page is another page"
	case abs(int(obs.Viewport.PageHeight)-int(s.settled.PageHeight)) > settledHeightTolerance:
		reason = fmt.Sprintf("the page is %.0f px tall now and was %.0f px when they were settled", obs.Viewport.PageHeight, s.settled.PageHeight)
	}
	if reason == "" {
		return
	}
	s.settled = settledState{changed: true}
	slog.Info(runName(s.id) + ": what was settled on the page is forgotten: " + reason + ".")
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
	return &SettledMap{PageHeight: s.settled.PageHeight, Spans: append([]Span{}, s.settled.Spans...)}
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
