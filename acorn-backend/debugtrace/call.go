package debugtrace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
)

// Tracer files each model call into the run attached to its request context.
// Calls outside a run (no signed-in request) are not recorded.
func Tracer() acorn.Tracer {
	return func(ctx context.Context, call acorn.Call) {
		run := RunFrom(ctx)
		if run == nil {
			return
		}
		run.WriteFile(fmt.Sprintf("ai-%s.md", call.Purpose), []byte(formatCall(call)))
	}
}

// formatCall renders a call as Markdown: outcome first, then the answer, then the prompts.
func formatCall(call acorn.Call) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", call.Purpose)
	fmt.Fprintf(&b, "- model: %s\n- duration: %s\n", call.Model, call.Duration.Round(1e6))
	if call.Err != nil {
		fmt.Fprintf(&b, "- error: %v\n", call.Err)
	}
	b.WriteString("\n## Response\n\n```json\n")
	b.WriteString(prettyJSON(call.Output))
	b.WriteString("\n```\n\n## System prompt\n\n```text\n")
	b.WriteString(call.System)
	b.WriteString("\n```\n\n## User prompt\n\n```text\n")
	b.WriteString(call.User)
	b.WriteString("\n```\n\n## Response schema\n\n```json\n")
	b.WriteString(prettyJSON(call.Schema))
	b.WriteString("\n```\n")
	return b.String()
}

func prettyJSON(raw []byte) string {
	var out bytes.Buffer
	if err := json.Indent(&out, raw, "", "  "); err != nil {
		return string(raw)
	}
	return out.String()
}
