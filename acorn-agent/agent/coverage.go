package agent

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// The model sees one screen at a time, so it cannot know what a long page holds above or below
// the screen. The run keeps, in screenshot pixels from the top of the page, which parts of it
// have been on screen, and the model is told which have not: a required question in a part
// nobody looked at is how an application is sent half empty. Pixels, not a share of the page:
// the page grows as it is filled in (messages appear), and a percentage would shift under the run.

// span is a part of the page, from and to in screenshot pixels from the top.
type span struct{ from, to float64 }

const (
	// layoutTolerance is how much taller or shorter the page may become before the parts
	// already looked at are not trusted: something above or below them moved.
	layoutTolerance = 12.0
	// minGap is the least part of the page worth looking at: less is a margin.
	minGap = 24.0
)

// coverage is what a run has looked at on the page it is on.
type coverage struct {
	url    string
	height float64
	spans  []span
	// floor is where the form begins when the run had to scroll down past a job description to
	// find it: what lies above is not the application, so it is not asked about.
	floor float64
}

// see records the part of the page a look showed. A new address, or a page that changed height,
// starts again: the earlier parts may not be where they were.
func (c *coverage) see(url string, vp Viewport) {
	if vp.PageHeight <= 0 {
		return
	}
	if url != c.url || math.Abs(vp.PageHeight-c.height) > layoutTolerance {
		c.spans, c.floor = nil, 0
	}
	c.url, c.height = url, vp.PageHeight
	from := math.Max(0, vp.ScrollY)
	to := math.Min(vp.PageHeight, vp.ScrollY+float64(vp.Height))
	if to > from {
		c.spans = mergeSpans(append(c.spans, span{from, to}))
	}
}

func mergeSpans(spans []span) []span {
	sort.Slice(spans, func(i, j int) bool { return spans[i].from < spans[j].from })
	var out []span
	for _, next := range spans {
		if n := len(out); n > 0 && next.from <= out[n-1].to+1 {
			out[n-1].to = math.Max(out[n-1].to, next.to)
			continue
		}
		out = append(out, next)
	}
	return out
}

// gaps are the parts of the page no look has shown, from the top.
func (c *coverage) gaps() []span {
	if c.height <= 0 {
		return nil
	}
	var out []span
	cursor := c.floor
	for _, seen := range c.spans {
		if seen.from-cursor > minGap {
			out = append(out, span{cursor, seen.from})
		}
		cursor = math.Max(cursor, seen.to)
	}
	if c.height-cursor > minGap {
		out = append(out, span{cursor, c.height})
	}
	return out
}

func formatSpans(spans []span) string {
	parts := make([]string, len(spans))
	for i, part := range spans {
		parts[i] = fmt.Sprintf("%.0f to %.0f", part.from, part.to)
	}
	return strings.Join(parts, ", ")
}

// line is what the model is told about the page's reach, or "" when the page fits the screen.
func (c *coverage) line(vp Viewport) string {
	if c.height <= float64(vp.Height)+8 {
		return ""
	}
	gaps := c.gaps()
	if len(gaps) == 0 {
		return fmt.Sprintf("The page is %.0f px tall (pixels from its top). You have looked at all of it.", c.height)
	}
	return fmt.Sprintf("The page is %.0f px tall (pixels from its top). You have looked at: %s. You have not looked at: %s. A required question may be in a part you have not seen.",
		c.height, formatSpans(c.spans), formatSpans(gaps))
}
