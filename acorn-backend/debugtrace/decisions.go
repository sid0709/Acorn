package debugtrace

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-backend/jev"
	"github.com/sid0709/acorn/acorn-backend/openai"
)

// decider is the SelectorGateway's decision model (selector.Decider).
type decider interface {
	Decide(ctx context.Context, req jev.Request) (jev.Response, error)
	Model() string
}

// tracedDecider files every decision into the run attached to its request.
type tracedDecider struct{ inner decider }

// TraceDecisions wraps a decision model so each call (the state it read, the
// questions, and the answers) is captured in the request's run.
func TraceDecisions(inner decider) decider { return tracedDecider{inner: inner} }

func (t tracedDecider) Model() string { return t.inner.Model() }

func (t tracedDecider) Decide(ctx context.Context, req jev.Request) (jev.Response, error) {
	started := time.Now()
	res, err := t.inner.Decide(ctx, req)
	if run := RunFrom(ctx); run != nil {
		name := openai.CallName(ctx)
		if name == "" {
			name = "decision"
		}
		run.WriteFile(fmt.Sprintf("jev-%s.md", name), []byte(formatDecision(name, t.inner.Model(), req, res, err, time.Since(started))))
	}
	return res, err
}

// formatDecision renders one decision as Markdown: answers first, then what was asked.
func formatDecision(name, model string, req jev.Request, res jev.Response, err error, took time.Duration) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n- model: %s\n- duration: %s\n- cost: %v\n", name, model, took.Round(time.Millisecond), res.Usage.Cost)
	if err != nil {
		fmt.Fprintf(&b, "- error: %v\n", err)
	}
	keys := make([]string, 0, len(req.Questions))
	for key := range req.Questions {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	b.WriteString("\n## Answers\n\n```json\n")
	answers, _ := json.MarshalIndent(res.Answers, "", "  ")
	b.Write(answers)
	b.WriteString("\n```\n\n## Questions\n")
	for _, key := range keys {
		question := req.Questions[key]
		fmt.Fprintf(&b, "\n### %s (%s)\n\n%s\n", key, question.Type, question.Instructions)
		criteria := make([]string, 0, len(question.Criteria))
		for option := range question.Criteria {
			criteria = append(criteria, option)
		}
		sort.Strings(criteria)
		for _, option := range criteria {
			fmt.Fprintf(&b, "- %s: %s\n", option, question.Criteria[option])
		}
	}
	b.WriteString("\n## State\n\n```text\n")
	b.WriteString(req.State)
	b.WriteString("\n```\n")
	return b.String()
}
