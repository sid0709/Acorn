package agent

import (
	"strings"
	"testing"
)

func clicks(points ...[2]float64) []Action {
	var out []Action
	for _, p := range points {
		x, y := p[0], p[1]
		out = append(out, Action{Kind: KindClick, X: &x, Y: &y})
	}
	return out
}

func TestRepeatedPressesOfOneSpotAreNamed(t *testing.T) {
	a := &Agent{cfg: Config{RepeatSteps: 2}}
	s := &session{}
	spot := [2]float64{721, 389}
	a.noteRepeat(s, clicks(spot, spot, spot))
	if len(s.notes) != 0 {
		t.Fatalf("one step of presses is not a repeat: %v", s.notes)
	}
	a.noteRepeat(s, clicks(spot, [2]float64{723, 390}))
	if len(s.notes) != 1 || !strings.Contains(s.notes[0], "5 presses") {
		t.Fatalf("two steps on one spot should be named with their presses: %v", s.notes)
	}
}

func TestAnotherSpotOrActionStartsTheCountAgain(t *testing.T) {
	a := &Agent{cfg: Config{RepeatSteps: 2}}
	s := &session{}
	a.noteRepeat(s, clicks([2]float64{10, 10}))
	a.noteRepeat(s, clicks([2]float64{200, 10}))
	a.noteRepeat(s, []Action{{Kind: KindWait, Ms: 100}})
	a.noteRepeat(s, clicks([2]float64{200, 10}))
	if len(s.notes) != 0 || s.repeatSteps != 1 {
		t.Fatalf("a different spot or a different action restarts the count: %v (%d)", s.notes, s.repeatSteps)
	}
}

func TestRepeatCheckIsOffAtZero(t *testing.T) {
	a := &Agent{}
	s := &session{}
	spot := [2]float64{5, 5}
	for i := 0; i < 4; i++ {
		a.noteRepeat(s, clicks(spot))
	}
	if len(s.notes) != 0 {
		t.Fatalf("RepeatSteps 0 never tells the model: %v", s.notes)
	}
}
