package agent

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// replySchemaName and replySchema are the shape the model must answer in. Every property
// is present on every answer (the provider's strict mode needs that); the ones an action
// does not use are null. Observation comes first so the model reads the screen before it
// decides, and memo is its own scratchpad: the one thing carried from step to step. It is
// null when the notes did not change, so the model does not write them out again. An
// action's check is what the screen should show once that action has run, null where the
// model must look for itself.
const replySchemaName = "agent_step"

var replySchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["observation", "memo", "job", "status", "message", "stop", "actions"],
  "properties": {
    "observation": {"type": "string"},
    "memo": {"type": ["string", "null"]},
    "job": {"type": "string"},
    "status": {"type": "string", "enum": ["working", "done", "need_person", "stuck"]},
    "message": {"type": "string"},
    "stop": {
      "anyOf": [
        {"type": "null"},
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["reason", "problem", "action"],
          "properties": {
            "reason": {"type": "string", "enum": ["captcha", "verification", "identity", "document", "sign_in", "page_problem", "other"]},
            "problem": {"type": "string"},
            "action": {"type": "string"}
          }
        }
      ]
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["kind", "x", "y", "text", "secret", "keys", "dx", "dy", "ms", "resume", "check"],
        "properties": {
          "kind": {"type": "string", "enum": ["click", "double_click", "triple_click", "right_click", "hover", "type", "key", "scroll", "upload", "wait"]},
          "x": {"type": ["number", "null"]},
          "y": {"type": ["number", "null"]},
          "text": {"type": ["string", "null"]},
          "secret": {"type": ["boolean", "null"]},
          "keys": {"type": ["string", "null"]},
          "dx": {"type": ["number", "null"]},
          "dy": {"type": ["number", "null"]},
          "ms": {"type": ["integer", "null"]},
          "resume": {"type": ["string", "null"]},
          "check": {"type": ["string", "null"]}
        }
      }
    }
  }
}`)

// reply is the model's answer as it arrives.
type reply struct {
	Observation string        `json:"observation"`
	Memo        *string       `json:"memo"`
	Job         string        `json:"job"`
	Status      string        `json:"status"`
	Message     string        `json:"message"`
	Stop        *StopInfo     `json:"stop"`
	Actions     []modelAction `json:"actions"`
}

type modelAction struct {
	Kind   string   `json:"kind"`
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
	maxKeyTokens   = 12
	minWaitMs      = 100
	maxWaitMs      = 10_000
	maxScrollPages = 3
	maxCheckChars  = 300
)

// checkActions turns the model's actions into ones the extension can run, and says why
// it refused the rest. An action that would land outside the screenshot, type nothing, or
// press no key is refused here, so the person's browser never receives a nonsense command.
func checkActions(step int, raw []modelAction, vp Viewport, maxActions int) (valid []Action, dropped []string) {
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
		if in.Check != nil {
			action.Check = clipText(strings.TrimSpace(*in.Check), maxCheckChars)
		}
		valid = append(valid, action)
	}
	return valid, dropped
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
