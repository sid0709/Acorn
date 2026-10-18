package agent

import (
	"strings"
	"testing"
)

func TestCoverageIsKeptInPixelsAndTheGapsAreNamed(t *testing.T) {
	var c coverage
	c.see("https://jobs.example/a", Viewport{Width: 1280, Height: 800, ScrollY: 800, PageHeight: 5560})
	c.see("https://jobs.example/a", Viewport{Width: 1280, Height: 800, ScrollY: 1500, PageHeight: 5560})
	if got := formatSpans(c.spans); got != "800 to 2300" {
		t.Fatalf("seen %s", got)
	}
	if got := formatSpans(c.gaps()); got != "0 to 800, 2300 to 5560" {
		t.Fatalf("gaps %s", got)
	}
	line := c.line(Viewport{Height: 800})
	if !strings.Contains(line, "5560 px tall") || !strings.Contains(line, "You have not looked at: 0 to 800, 2300 to 5560") {
		t.Fatalf("line %q", line)
	}
	// The page grew: what was seen is no longer trusted.
	c.see("https://jobs.example/a", Viewport{Width: 1280, Height: 800, ScrollY: 0, PageHeight: 5700})
	if got := formatSpans(c.spans); got != "0 to 800" {
		t.Fatalf("after the page grew, seen %s", got)
	}
	// A page that fits the screen has nothing unseen.
	var short coverage
	short.see("u", Viewport{Height: 800, PageHeight: 800})
	if len(short.gaps()) != 0 || short.line(Viewport{Height: 800}) != "" {
		t.Fatalf("a page that fits has gaps %v", short.gaps())
	}
}

func TestWhatLiesAboveWhereTheFormBeganIsNotAGap(t *testing.T) {
	var c coverage
	c.see("u", Viewport{Height: 800, ScrollY: 2000, PageHeight: 4000})
	c.floor = 1600
	if got := formatSpans(c.gaps()); got != "1600 to 2000, 2800 to 4000" {
		t.Fatalf("gaps %s: the job description above the form counted", got)
	}
}
