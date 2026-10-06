// Package selector is Acorn's SelectorGateway: every "pick one of these" decision
// goes to TypeSafe Jev and nowhere else. A text model writes answers; the gateway
// only chooses among things that already exist — a dropdown's options, or the
// account's Library résumés — and says how sure it is.
package selector

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

const (
	optionQuestion  = "option"
	postingQuestion = "is_job_posting"
	resumeQuestion  = "resume"

	// notListedKey lets Jev say the intended answer is missing from a list that may be partial.
	notListedKey = "not_listed"
	// noResumeKey lets Jev say no Library résumé fits the posting.
	noResumeKey = "none"

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

// OptionQuery is one dropdown decision: which listed option to select.
type OptionQuery struct {
	Field    string
	Intended string
	// Typed is the search text already in the dropdown, when the list was narrowed by typing.
	Typed   string
	Options []string
	// AllowNotListed is true when the list may be partial (a search box can reveal
	// more), so "not here" is a valid answer and the caller keeps searching.
	AllowNotListed bool
	// Applicant is the signed-in applicant's profile: the facts behind the answer.
	Applicant string
}

// OptionPick is the option to select. Option is "" when Jev chose "not listed";
// Fallback is still the best listed option, so a caller that cannot search further
// can use it without asking again.
type OptionPick struct {
	Option     string
	Fallback   string
	Confidence float64
	Usage      jev.Usage
}

// PickOption chooses the listed option that answers the field. When none means
// the intended answer, Jev picks the closest one an applicant would choose
// (a broader category, or "Other") instead of failing.
func (g *Gateway) PickOption(ctx context.Context, q OptionQuery) (OptionPick, error) {
	options := uniqueTrimmed(q.Options)
	if strings.TrimSpace(q.Intended) == "" || len(options) == 0 {
		return OptionPick{}, fmt.Errorf("%w: intended value and options are required", ErrInvalid)
	}
	limit := jev.MaxChoiceOptions
	if q.AllowNotListed {
		limit--
	}
	if len(options) > limit {
		options = options[:limit]
	}

	keys, criteria := keyed(options, "option")
	if q.AllowNotListed {
		criteria[notListedKey] = "None of the listed options means the intended answer, and this list may be only part of the options (a search can show more)."
	}
	res, err := g.decider.Decide(ctx, jev.Request{
		State: optionState(q),
		Questions: map[string]jev.Question{optionQuestion: {
			Type:         jev.TypeChoice,
			Instructions: optionInstructions(q.AllowNotListed),
			Criteria:     criteria,
		}},
	})
	if err != nil {
		return OptionPick{}, err
	}
	answer, ok := res.Answers[optionQuestion]
	if !ok {
		return OptionPick{}, errors.New("jev returned no option answer")
	}
	pick := OptionPick{
		Fallback:   keys[bestKey(answer.Probabilities, keys)],
		Confidence: answer.Confidence,
		Usage:      res.Usage,
	}
	if answer.Choice != notListedKey {
		pick.Option = keys[answer.Choice]
	}
	if pick.Option == "" && !q.AllowNotListed {
		pick.Option = pick.Fallback
	}
	return pick, nil
}

func optionState(q OptionQuery) string {
	lines := []string{
		"Form field: " + firstNonEmpty(q.Field, "(unlabeled)"),
		"Applicant's intended answer: " + strings.TrimSpace(q.Intended),
	}
	if typed := strings.TrimSpace(q.Typed); typed != "" {
		lines = append(lines, "Text typed into the dropdown's search box: "+typed)
	}
	if applicant := strings.TrimSpace(q.Applicant); applicant != "" {
		lines = append(lines, "", "Applicant profile (the facts the answer comes from):", applicant)
	}
	return strings.Join(lines, "\n")
}

func optionInstructions(allowNotListed bool) string {
	base := "Pick the option the applicant should select in this form field. " +
		"Prefer the option that means the same as the intended answer (same fact, wording may differ). " +
		"When the intended answer points at the profile, answer from the applicant profile. " +
		"If no option means it, pick the option a careful applicant would choose instead: " +
		"the closest broader category, or Other when that exists."
	if allowNotListed {
		return base + " Choose not_listed only when the intended answer is a specific value that should be in a complete list (a country, school, or company name) and it is missing here."
	}
	return base
}

// Candidate is one thing a posting can match, such as a Library résumé.
type Candidate struct {
	ID          string
	Description string
}

// PostingMatch says whether the text is a job posting and which candidate fits it.
// ID is "" when the text is not a posting or nothing fits.
type PostingMatch struct {
	IsPosting  bool
	PostingP   float64
	ID         string
	Confidence float64
	Usage      jev.Usage
}

// MatchPosting asks Jev, in one call, whether the text is a job posting and which
// candidate résumé fits it best.
func (g *Gateway) MatchPosting(ctx context.Context, posting string, candidates []Candidate) (PostingMatch, error) {
	posting = strings.TrimSpace(posting)
	if posting == "" || len(candidates) == 0 {
		return PostingMatch{}, fmt.Errorf("%w: posting text and candidates are required", ErrInvalid)
	}
	if len(candidates) > jev.MaxChoiceOptions-1 {
		candidates = candidates[:jev.MaxChoiceOptions-1]
	}
	descriptions := make([]string, len(candidates))
	for i, candidate := range candidates {
		descriptions[i] = candidate.Description
	}
	_, criteria := keyed(descriptions, "resume")
	criteria[noResumeKey] = "None of these résumés fits the role in this posting."

	res, err := g.decider.Decide(ctx, jev.Request{
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
	if match.IsPosting && answer.Choice != noResumeKey {
		if index, ok := keyIndex(answer.Choice, "resume"); ok && index < len(candidates) {
			match.ID = candidates[index].ID
		}
	}
	return match, nil
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

func keyIndex(key, prefix string) (int, bool) {
	var index int
	if _, err := fmt.Sscanf(key, prefix+"_%d", &index); err != nil {
		return 0, false
	}
	return index, true
}

// bestKey is the most probable key that names a listed value.
func bestKey(probabilities map[string]float64, keys map[string]string) string {
	best, bestP := "", -1.0
	for key, p := range probabilities {
		if _, listed := keys[key]; listed && (p > bestP || (p == bestP && key < best)) {
			best, bestP = key, p
		}
	}
	return best
}

func uniqueTrimmed(items []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" && !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	return out
}

func clip(text string, max int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max-1]) + "…"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
