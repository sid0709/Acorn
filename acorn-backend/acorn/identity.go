package acorn

import (
	"context"
	"log/slog"
)

// identityInstructions and identityKinds are the decision-model form of the
// identity_system prompt: one choice per planned question.
const identityInstructions = "Classify this job-application question by what it asks, not by keywords."

var identityKinds = map[string]string{
	kindApplicationAI: "Asks whether the applicant used an AI or automated tool to write, fill, or submit THIS application; whether the applicant is a bot; or whether they consent to automated hiring, screening, or employment-decision tools assessing them.",
	kindWorkplaceAI:   "Asks about the applicant's professional use of AI assistants or language models in their own work: which tools, how often, or examples of impact.",
	kindOther:         "Anything else, including SMS, email, or phone communication consent.",
}

// classifyIdentityByDecision finds the "did you use AI to apply" questions with the
// decision model. It fails open, like the text-model classifier.
func (s *Service) classifyIdentityByDecision(ctx context.Context, fields []identityQuestion) map[int]bool {
	if len(fields) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, identityTimeout)
	defer cancel()
	items := make(map[int]string, len(fields))
	for _, field := range fields {
		items[field.ElementIndex] = field.Question
	}
	kinds, err := s.classifier.ClassifyEach(ctx, identityInstructions, identityKinds, items)
	if err != nil {
		slog.Warn("acorn identity classify skipped", "error", err)
		return nil
	}
	out := map[int]bool{}
	for index, kind := range kinds {
		if kind == kindApplicationAI {
			out[index] = true
		}
	}
	return out
}
