package agent

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// reply is the model's answer as it arrives.
type reply struct {
	Observation string        `json:"observation"`
	Memo        *string       `json:"memo"`
	Job         *string       `json:"job"`
	Status      string        `json:"status"`
	Message     string        `json:"message"`
	Stop        *StopInfo     `json:"stop"`
	Actions     []modelAction `json:"actions"`
}

type modelAction struct {
	Kind   string   `json:"kind"`
	Screen *int     `json:"screen"`
	X      *float64 `json:"x"`
	Y      *float64 `json:"y"`
	Text   *string  `json:"text"`
	Secret *bool    `json:"secret"`
	Keys   *string  `json:"keys"`
	DX     *float64 `json:"dx"`
	DY     *float64 `json:"dy"`
	Ms     *int     `json:"ms"`
	Resume *string  `json:"resume"`
	Check  *string  `json:"check"`
}

// parseReply reads the model's JSON answer. It reads the first JSON object and ignores what
// comes around it (a code fence, a stray character after the closing brace): asking the model
// again for a slip like that costs a whole call.
func parseReply(content string) (reply, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return reply{}, fmt.Errorf("the model sent an empty answer")
	}
	if start := strings.IndexByte(content, '{'); start > 0 {
		content = content[start:]
	}
	var out reply
	if err := json.NewDecoder(strings.NewReader(content)).Decode(&out); err != nil {
		return reply{}, fmt.Errorf("the model's answer is not the requested JSON: %w", err)
	}
	switch out.Status {
	case StatusWorking, StatusDone, StatusNeedPerson, StatusStuck:
	default:
		return reply{}, fmt.Errorf("the model's status %q is not one of working, done, need_person, stuck", out.Status)
	}
	return out, nil
}

// Limits on what one step may ask for.
const (
	maxTypeChars   = 2000
	maxChooseChars = 200
	maxKeyTokens   = 12
	minWaitMs      = 100
	maxWaitMs      = 10_000
	maxScrollPages = 3
	maxCheckChars  = 300
)

// checkActions turns the model's actions into ones the extension can run, and says why
// it refused the rest. An action that would land outside the screenshot, type nothing, or
// press no key is refused here, so the person's browser never receives a nonsense command.
func checkActions(step int, raw []modelAction, vp Viewport, maxActions int, screens []float64) (valid []Action, dropped []string) {
	for i, in := range raw {
		if len(valid) == maxActions {
			dropped = append(dropped, fmt.Sprintf("action %d (%s): only %d actions run per step", i+1, in.Kind, maxActions))
			continue
		}
		action := Action{ID: fmt.Sprintf("s%da%d", step, i+1), Kind: in.Kind}
		if reason := fill(&action, in, vp); reason != "" {
			dropped = append(dropped, fmt.Sprintf("action %d (%s): %s", i+1, in.Kind, reason))
			continue
		}
		if reason := placeOnScreen(&action, in, vp, screens); reason != "" {
			dropped = append(dropped, fmt.Sprintf("action %d (%s): %s", i+1, in.Kind, reason))
			continue
		}
		if in.Check != nil {
			action.Check = clipText(strings.TrimSpace(*in.Check), maxCheckChars)
		}
		valid = append(valid, action)
	}
	return valid, dropped
}

// placeOnScreen sets where the page must be scrolled for an action whose point the model
// measured on a screen of a multi-screenshot survey. On a single screenshot, x and y are already
// on the image shown; a stray "screen" field from the model is ignored.
func placeOnScreen(action *Action, in modelAction, vp Viewport, screens []float64) string {
	if in.Screen == nil {
		return ""
	}
	switch in.Kind {
	case KindClick, KindDoubleClick, KindTripleClick, KindRightClick, KindHover, KindUpload, KindChoose:
	default:
		return "" // typing and keys follow the action before them
	}
	if len(screens) == 0 {
		return ""
	}
	screen := *in.Screen
	if screen == 0 {
		screen = 1
	}
	if screen < 1 || screen > len(screens) {
		return fmt.Sprintf("there is no screen %d (the survey has %d)", *in.Screen, len(screens))
	}
	scroll := screens[screen-1]
	action.ScrollTo, action.PageHeight = &scroll, vp.PageHeight
	action.Zone = screen
	return ""
}

// fill copies the fields an action of this kind uses and returns why it cannot run, if it cannot.
func fill(out *Action, in modelAction, vp Viewport) string {
	switch in.Kind {
	case KindClick, KindDoubleClick, KindTripleClick, KindRightClick, KindHover, KindUpload:
		if reason := point(out, in, vp); reason != "" {
			return reason
		}
		if in.Kind == KindUpload && in.Resume != nil {
			out.Resume = strings.TrimSpace(*in.Resume)
		}
	case KindChoose:
		if reason := point(out, in, vp); reason != "" {
			return reason
		}
		answer := ""
		if in.Text != nil {
			answer = strings.TrimSpace(*in.Text)
		}
		if answer == "" {
			return "there is no answer to choose"
		}
		if len([]rune(answer)) > maxChooseChars {
			return fmt.Sprintf("the answer is longer than %d characters", maxChooseChars)
		}
		out.Text = answer
	case KindType:
		text := ""
		if in.Text != nil {
			text = *in.Text
		}
		if text == "" {
			return "there is no text to type"
		}
		if len([]rune(text)) > maxTypeChars {
			return fmt.Sprintf("the text is longer than %d characters", maxTypeChars)
		}
		out.Text = text
		out.Secret = in.Secret != nil && *in.Secret
	case KindKey:
		keys := ""
		if in.Keys != nil {
			keys = strings.TrimSpace(*in.Keys)
		}
		if keys == "" {
			return "there is no key to press"
		}
		if len(strings.Fields(keys)) > maxKeyTokens {
			return fmt.Sprintf("more than %d keys", maxKeyTokens)
		}
		out.Keys = keys
	case KindScroll:
		dx, dy := number(in.DX), number(in.DY)
		if dx == 0 && dy == 0 {
			return "there is no distance to scroll"
		}
		out.DX = clamp(dx, float64(maxScrollPages*vp.Width))
		out.DY = clamp(dy, float64(maxScrollPages*vp.Height))
		// A scroll with no point scrolls where the page's middle is.
		x, y := float64(vp.Width)/2, float64(vp.Height)/2
		if in.X != nil && in.Y != nil && inside(*in.X, *in.Y, vp) {
			x, y = *in.X, *in.Y
		}
		out.X, out.Y = &x, &y
	case KindSurvey:
		// Nothing to carry: the step asks the extension for a survey on its next look.
	case KindWait:
		ms := 1000
		if in.Ms != nil {
			ms = *in.Ms
		}
		out.Ms = min(max(ms, minWaitMs), maxWaitMs)
	default:
		return "that is not an action the agent can send"
	}
	return ""
}

func point(out *Action, in modelAction, vp Viewport) string {
	if in.X == nil || in.Y == nil {
		return "it has no point"
	}
	if !inside(*in.X, *in.Y, vp) {
		return fmt.Sprintf("the point (%.0f, %.0f) is outside the %dx%d screenshot", *in.X, *in.Y, vp.Width, vp.Height)
	}
	x, y := math.Round(*in.X), math.Round(*in.Y)
	out.X, out.Y = &x, &y
	return ""
}

func inside(x, y float64, vp Viewport) bool {
	return x >= 0 && y >= 0 && x < float64(vp.Width) && y < float64(vp.Height)
}

func number(value *float64) float64 {
	if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) {
		return 0
	}
	return *value
}

func clamp(value, limit float64) float64 {
	return math.Max(-limit, math.Min(limit, value))
}
