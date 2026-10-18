package agent

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-agent/llm"
)

// The applicant is a human. This is Oak's rule for it, kept whole: the prompt tells the planner so
// (prompts/prefill.md, rule 15), a second call classifies the questions the planner answered by what
// they ask, and a "yes" to a question about using AI on, or consenting to automated assessment of,
// this application is made a "no". The extension then checks the wording of each question once more
// before it types (acorn/extension/src/agent/prefill/applicant-identity.ts).

//go:embed prompts/identity.md
var identityPrompt string

const (
	// identityTimeout bounds the classification of the questions: when it is slow the answers stand as
	// the planner gave them (Oak's OAK_IDENTITY_TIMEOUT_MS).
	identityTimeout    = 8 * time.Second
	identitySchemaName = "identity_classify"
	// identityApplicationAI is the kind of question a "yes" is made a "no" for.
	identityApplicationAI = "application_ai"
)

var identitySchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["classifications"],
  "properties": {
    "classifications": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["element_index", "kind"],
        "properties": {
          "element_index": {"type": "number"},
          "kind": {"type": "string", "enum": ["application_ai", "workplace_ai", "other"]}
        }
      }
    }
  }
}`)

var (
	yesLike     = regexp.MustCompile(`(?i)^(yes|y|true|i consent|i agree|agree|consent|i do consent)$`)
	consentLike = regexp.MustCompile(`(?i)^(i\s+)?(consent|agree)\b`)
)

// rewriteYes is "No" for a value that says yes or consent, and the value itself otherwise.
func rewriteYes(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return value
	}
	if yesLike.MatchString(trimmed) || consentLike.MatchString(trimmed) {
		return "No"
	}
	return value
}

// identityUser lists the questions the planner answered, as Oak does.
func identityUser(fills []PrefillFill) string {
	blocks := make([]string, 0, len(fills))
	for _, fill := range fills {
		role := fill.Role
		if role == "" {
			role = "(none)"
		}
		blocks = append(blocks, fmt.Sprintf("element_index: %d\nrole: %s\nquestion: %s", fill.Ref, role, fill.Label))
	}
	return "Questions:\n" + strings.Join(blocks, "\n\n") + "\n\nReturn json with one classifications[].kind per element_index."
}

// applicationAIRefs reads the classifier's answer: the questions about this application's use of AI.
func applicationAIRefs(content string, allowed map[int]bool) (map[int]bool, error) {
	content = strings.TrimSpace(content)
	if start := strings.IndexByte(content, '{'); start > 0 {
		content = content[start:]
	}
	var parsed struct {
		Classifications []struct {
			ElementIndex float64 `json:"element_index"`
			Kind         string  `json:"kind"`
		} `json:"classifications"`
	}
	if err := json.NewDecoder(strings.NewReader(content)).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("the classifier's answer is not the requested JSON: %w", err)
	}
	refs := map[int]bool{}
	for _, row := range parsed.Classifications {
		ref := int(row.ElementIndex)
		if allowed[ref] && row.Kind == identityApplicationAI {
			refs[ref] = true
		}
	}
	return refs, nil
}

// keepApplicantHuman classifies the questions of a plan and makes the answers to those about this
// application's use of AI the ones a human applicant gives. A classifier that fails or is slow
// changes nothing: the answers stand as planned, and the extension's own wording check still runs.
// It returns the call for the trace.
func (a *Agent) keepApplicantHuman(ctx context.Context, s *session, fills []PrefillFill) ([]PrefillFill, *modelCall) {
	asked := make([]PrefillFill, 0, len(fills))
	allowed := map[int]bool{}
	for _, fill := range fills {
		if fill.Label != "" && !allowed[fill.Ref] {
			asked = append(asked, fill)
			allowed[fill.Ref] = true
		}
	}
	if len(asked) == 0 {
		return fills, nil
	}
	messages := []llm.Message{
		{Role: llm.RoleSystem, Text: identityPrompt},
		{Role: llm.RoleUser, Text: identityUser(asked)},
	}
	callCtx, cancel := context.WithTimeout(ctx, identityTimeout)
	defer cancel()
	resp, err := a.newModel(s.key).Complete(callCtx, llm.Request{Messages: messages, SchemaName: identitySchemaName, Schema: identitySchema})
	s.charge(resp.Usage)
	call := &modelCall{
		Messages: traceMessages(messages), Content: resp.Content, FinishReason: resp.FinishReason, Model: resp.Model,
		Usage: resp.Usage, LatencyMs: resp.Latency.Milliseconds(), HTTPAttempts: resp.Attempts,
	}
	var refs map[int]bool
	if err == nil {
		refs, err = applicationAIRefs(resp.Content, allowed)
	}
	if err != nil {
		call.Error = err.Error()
		slog.Warn("identity classification skipped", "session", s.id, "error", err)
		return fills, call
	}
	out := make([]PrefillFill, len(fills))
	copy(out, fills)
	for i := range out {
		if refs[out[i].Ref] {
			out[i].Value = rewriteYes(out[i].Value)
		}
	}
	return out, call
}
