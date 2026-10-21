package agent

import (
	"context"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-agent/llm"
	"github.com/sid0709/acorn/acorn-backend/jev"
)

// The agent asks two shapes of decision: a question about a screenshot (Screen) and a pick among things
// that already exist, asked of text (Decider: which résumé, whether a page holds a job description, what a
// control or a frame that opened is). Both go through one gateway (decide.Gateway), which sends each to the
// route set for its kind, on the person's keys. A pick is written in Jev's shape (a state as one text) and
// asked through the gateway, and recorded for the trace like a check: what it was for, the model that
// answered, and the timing of each request it sent, so the run's summary can say how each model did.

// decideText asks a text-only pick through the gateway and records it for the next entry of the trace. The
// session is locked.
func (a *Agent) decideText(ctx context.Context, s *session, purpose string, req jev.Request) (jev.Response, error) {
	questions := make(map[string]decide.Question, len(req.Questions))
	for key, question := range req.Questions {
		questions[key] = decide.Question{Type: question.Type, Instructions: question.Instructions, Criteria: question.Criteria}
	}
	res, err := a.newDecider(s.keys()).Decide(ctx, decide.Request{State: []decide.Part{decide.Text(req.State)}, Questions: questions})
	call := modelCall{
		Kind:      "decision",
		Messages:  []tracedMessage{{Role: "state", Text: purpose}},
		Model:     res.Model,
		Usage:     llm.Usage{InputTokens: res.Usage.InputTokens, OutputTokens: res.Usage.OutputTokens, Cost: res.Usage.Cost},
		LatencyMs: res.Latency.Milliseconds(),
	}.timed(res.StartedAt, res.Requests)
	if err != nil {
		call.Error = err.Error()
	}
	s.reviews.calls = append(s.reviews.calls, call)
	out := jev.Response{
		Model:   res.Model,
		Answers: make(map[string]jev.Answer, len(res.Answers)),
		Usage:   jev.Usage{InputTokens: res.Usage.InputTokens, OutputTokens: res.Usage.OutputTokens, Cost: res.Usage.Cost},
	}
	for key, answer := range res.Answers {
		out.Answers[key] = jev.Answer{
			Type: answer.Type, Choice: answer.Choice, Noul: answer.Noul, Confidence: answer.Confidence, Probabilities: answer.Probabilities,
		}
	}
	return out, err
}

// keys are the person's keys the run's decisions are asked on.
func (s *session) keys() decide.Keys {
	return decide.Keys{OpenRouter: s.key, OpenAI: s.openaiKey}
}
