package agent

import (
	"fmt"
	"log/slog"
	"math"
	"strings"
)

// Every page of an application has one control that the rest of the page leads to: the button that sends
// it, or goes on to its next step (Submit, Next, Continue, Create account, Sign in, Review). The model names
// it on the page's first survey (reply.Next), from the picture, and the run keeps it as the page's key: it
// is painted red on the map, no stretch that holds it is ever settled, and when the run idles with the key
// not pressed (nothing usable to do, or a page unchanged for too long) the model is sent back to what is
// still empty, else to the key. A recorded run filled a page and then stood still for six looks with the
// button that sends it just below the screens it had settled.

const (
	// keyBandPx is half the height of the band painted round the key on the map (screenshot pixels).
	keyBandPx = 14
	// keyNearPx is how close to the key's point a click must be to count as pressing it.
	keyNearPx = 24
)

// keyControl is the key of one page: where it is (screenshot pixels from the page's top left) and what it
// is called; pressed once a plan clicked it, and nudges how many times the run was sent back to it.
type keyControl struct {
	URL     string
	X, Y    float64
	Label   string
	pressed bool
	nudges  int
}

// noteKey keeps the control the model named in "next" on a survey, once per page.
func (s *session) noteKey(answer reply, obs Observation) {
	next := answer.Next
	if next == nil || next.Screen == nil || next.X == nil || next.Y == nil {
		return
	}
	n := *next.Screen
	if n < 1 || n > len(obs.Survey) {
		return
	}
	url := withoutFragment(obs.URL)
	if s.pageKey != nil && s.pageKey.URL == url {
		return
	}
	label := ""
	if next.Label != nil {
		label = strings.TrimSpace(*next.Label)
	}
	s.pageKey = &keyControl{URL: url, X: obs.Viewport.ScrollX + *next.X, Y: obs.Survey[n-1].ScrollY + *next.Y, Label: label}
	s.settled.changed = true
	slog.Info(fmt.Sprintf("%s: the model named %s, %.0f px from the top of the page.", runName(s.id), s.pageKey.name(), s.pageKey.Y))
}

// keyOn is the key of the page being looked at, or nil.
func (s *session) keyOn(obs Observation) *keyControl {
	if s.pageKey != nil && s.pageKey.URL == withoutFragment(obs.URL) {
		return s.pageKey
	}
	return nil
}

// name is the key as the model is told of it.
func (k *keyControl) name() string {
	if k.Label != "" {
		return fmt.Sprintf("the control %q that sends this page or goes on", k.Label)
	}
	return "the control that sends this page or goes on"
}

// span is the band painted round the key on the map.
func (k *keyControl) span() Span {
	return Span{From: math.Max(k.Y-keyBandPx, 0), To: k.Y + keyBandPx}
}

// within is whether a stretch of the page holds the key; a nil key is nowhere.
func (k *keyControl) within(from, to float64) bool {
	return k != nil && k.Y >= from && k.Y <= to
}

// notePressed marks the key pressed when a plan going out clicks it: a click the model marks as the one
// that sends or goes on, or one near the key's point.
func (s *session) notePressed(planned []Action, obs Observation) {
	k := s.keyOn(obs)
	if k == nil || k.pressed {
		return
	}
	for _, action := range planned {
		if !isPointAction(action) || action.Kind == KindUpload {
			continue
		}
		if action.Commit != "" || math.Abs(pageY(action, obs)-k.Y) <= keyNearPx {
			k.pressed = true
			return
		}
	}
}

// goOnNote is where the model is sent when the run idles with the key not pressed: to the required fields
// the page still reports empty, else to the key. Once per page; the next look is a survey, so the key's
// screen is in it. It reports false when there is no key, or it was pressed or sent to already.
func (s *session) goOnNote(obs Observation) (string, bool) {
	k := s.keyOn(obs)
	if k == nil || k.pressed || k.nudges > 0 {
		return "", false
	}
	k.nudges++
	s.surveyAgain = true
	if left := s.emptyFieldsOn(obs.URL); len(left) > 0 {
		return fmt.Sprintf("The page still reports these required fields empty: %s. Go to each, check it on the screen and fill it. "+
			"Then press %s, %.0f px from the top of the page.", quoted(left), k.name(), k.Y), true
	}
	return fmt.Sprintf("Everything you can fill looks done. %s is %.0f px from the top of the page: scroll there and press it, marked \"commit\".",
		k.name(), k.Y), true
}
