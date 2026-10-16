// Package selector is Acorn's SelectorGateway: every "pick one of these" decision
// goes to TypeSafe Jev and nowhere else. A text model writes answers; the gateway
// only chooses among things that already exist — a dropdown's options, or the
// account's Library résumés — and says how sure it is.
package selector

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	postingQuestion = "is_job_posting"
	resumeQuestion  = "resume"

	resumeKeyPrefix = "resume"

	// postingThreshold is the P(yes) at or above which the page counts as a job posting.
	postingThreshold = 0.5
	// maxDescription bounds one criteria description; Jev reads the whole request as input.
	maxDescription = 600
)

// ErrInvalid is a request the caller should fix, not retry.
var ErrInvalid = errors.New("invalid selector request")

// Decider is the decision model behind the gateway. *jev.Client is the real one.
type Decider interface {
	Decide(ctx context.Context, req jev.Request) (jev.Response, error)
	Model() string
}

// Gateway turns Acorn's selection problems into Jev questions.
type Gateway struct {
	decider Decider
}

func New(decider Decider) *Gateway { return &Gateway{decider: decider} }

// Model is the decision model's id.
func (g *Gateway) Model() string { return g.decider.Model() }

// Candidate is one thing a posting can match, such as a Library résumé.
type Candidate struct {
	ID          string
	Description string
}

// Ranked is one candidate and Jev's probability that it is the best fit.
type Ranked struct {
	ID          string
	Probability float64
}

// PostingMatch says whether the text is a job posting and ranks every candidate,
// most probable first. Ranked[0] is the pick; there is no threshold and no "none".
type PostingMatch struct {
	IsPosting  bool
	PostingP   float64
	Ranked     []Ranked
	Confidence float64
	Usage      jev.Usage
}

// MatchPosting asks Jev, in one call, whether the text is a job posting and how
// well each candidate résumé fits it.
func (g *Gateway) MatchPosting(ctx context.Context, posting string, candidates []Candidate) (PostingMatch, error) {
	posting = strings.TrimSpace(posting)
	if posting == "" || len(candidates) == 0 {
		return PostingMatch{}, fmt.Errorf("%w: posting text and candidates are required", ErrInvalid)
	}
	if len(candidates) > jev.MaxChoiceOptions {
		candidates = candidates[:jev.MaxChoiceOptions]
	}
	descriptions := make([]string, len(candidates))
	for i, candidate := range candidates {
		descriptions[i] = candidate.Description
	}
	_, criteria := keyed(descriptions, resumeKeyPrefix)

	res, err := g.decider.Decide(openai.WithCall(ctx, "recommend"), jev.Request{
		State: posting,
		Questions: map[string]jev.Question{
			postingQuestion: {
				Type:         jev.TypeNoul,
				Instructions: "Is this text a job posting or job description for a specific role (duties, requirements, or qualifications)?",
				Criteria: map[string]string{
					"true":  "A job posting, job description, or application page that describes the role.",
					"false": "Anything else: a search results list, a company page, a login page, or an application form with no role description.",
				},
			},
			resumeQuestion: {
				Type:         jev.TypeChoice,
				Instructions: "Which résumé should the applicant send for this role? Match the role's main tech stack, domain, and required skills to each résumé's stack and skills.",
				Criteria:     criteria,
			},
		},
	})
	if err != nil {
		return PostingMatch{}, err
	}
	match := PostingMatch{Usage: res.Usage}
	if answer, ok := res.Answers[postingQuestion]; ok && answer.Noul != nil {
		match.PostingP = *answer.Noul
		match.IsPosting = match.PostingP >= postingThreshold
	}
	answer, ok := res.Answers[resumeQuestion]
	if !ok {
		return PostingMatch{}, errors.New("jev returned no résumé answer")
	}
	match.Confidence = answer.Confidence
	match.Ranked = rank(candidates, answer)
	return match, nil
}

// rank orders every candidate by Jev's probability; Jev's own choice wins a tie.
func rank(candidates []Candidate, answer jev.Answer) []Ranked {
	ranked := make([]Ranked, len(candidates))
	chosen := -1
	for i, candidate := range candidates {
		key := fmt.Sprintf("%s_%d", resumeKeyPrefix, i)
		ranked[i] = Ranked{ID: candidate.ID, Probability: answer.Probabilities[key]}
		if key == answer.Choice {
			chosen = i
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].Probability != ranked[j].Probability {
			return ranked[i].Probability > ranked[j].Probability
		}
		return chosen >= 0 && ranked[i].ID == candidates[chosen].ID
	})
	return ranked
}

// keyed gives each value a short stable key ("option_0", …). Jev answers with the
// key, so option labels with any characters round-trip exactly.
func keyed(values []string, prefix string) (map[string]string, map[string]string) {
	keys := make(map[string]string, len(values))
	criteria := make(map[string]string, len(values)+1)
	for i, value := range values {
		key := fmt.Sprintf("%s_%d", prefix, i)
		keys[key] = value
		criteria[key] = clip(value, maxDescription)
	}
	return keys, criteria
}

func clip(text string, max int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max-1]) + "…"
}
