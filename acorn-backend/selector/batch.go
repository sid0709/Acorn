package selector

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// applicantRules hold for every answer: the applicant is the human in the profile.
const applicantRules = "The applicant is the human in the profile: never answer that they used AI or an automated tool to apply, that they are a bot, or that they consent to automated or AI tools deciding on or screening their application. Every other consent or acknowledgement (privacy, data processing, survey responses, accuracy of the application, terms) is the applicant's to give. Answer work authorization from the profile's immigration status and visa sponsorship from its sponsorship answer."

// ChoiceItem is one choice field decided in a batch: a single pick, or the set of
// boxes to check when Multiple.
type ChoiceItem struct {
	ID       int
	Field    string
	Intended string
	Options  []string
	Multiple bool
}

// ChoicePick is a batch answer: one option, or every box to check.
type ChoicePick struct {
	ID      int
	Options []string
}

// batchQuestion is one Jev question and how its answer maps back to an item.
type batchQuestion struct {
	key      string
	item     int
	option   string // multiple: the box this yes/no is about
	question jev.Question
	keys     map[string]string // single: criteria key → option label
}

// PickBatch decides many choice fields at once. The applicant profile is the shared
// state, sent once per request; each field is its own question. Single fields take
// the most probable option; checkbox fields take every box Jev says to check (the
// most probable one when it says no to all). Requests run in parallel batches.
func (g *Gateway) PickBatch(ctx context.Context, applicant string, items []ChoiceItem) ([]ChoicePick, jev.Usage, error) {
	questions := batchQuestions(items)
	state := "Applicant profile (the facts every answer comes from):\n" + strings.TrimSpace(applicant) + "\n\n" + applicantRules
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		answers  = map[string]jev.Answer{}
		usage    jev.Usage
		firstErr error
	)
	for start := 0; start < len(questions); start += maxQuestionsPerDecision {
		batch := questions[start:min(start+maxQuestionsPerDecision, len(questions))]
		wg.Add(1)
		go func() {
			defer wg.Done()
			asked := make(map[string]jev.Question, len(batch))
			for _, q := range batch {
				asked[q.key] = q.question
			}
			res, err := g.decider.Decide(ctx, jev.Request{State: state, Questions: asked})
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			usage.InputTokens += res.Usage.InputTokens
			usage.OutputTokens += res.Usage.OutputTokens
			usage.Cost += res.Usage.Cost
			for key, answer := range res.Answers {
				answers[key] = answer
			}
		}()
	}
	wg.Wait()
	if len(answers) == 0 && firstErr != nil {
		return nil, usage, firstErr
	}
	return collectPicks(items, questions, answers), usage, nil
}

func batchQuestions(items []ChoiceItem) []batchQuestion {
	var out []batchQuestion
	for _, item := range items {
		options := uniqueTrimmed(item.Options)
		if len(options) == 0 {
			continue
		}
		field := "Form field: " + firstNonEmpty(item.Field, "(unlabeled)") + "\nApplicant's intended answer: " + strings.TrimSpace(item.Intended)
		if item.Multiple {
			for i, label := range options[:min(len(options), MaxCheckboxOptions)] {
				out = append(out, batchQuestion{
					key: fmt.Sprintf("f%d_box%d", item.ID, i), item: item.ID, option: label,
					question: jev.Question{
						Type:         jev.TypeNoul,
						Instructions: field + "\nShould the applicant check the box \"" + clip(label, maxDescription) + "\"? Check every box that matches the intended answer or the applicant profile.",
					},
				})
			}
			continue
		}
		keys, criteria := keyed(options[:min(len(options), jev.MaxChoiceOptions)], "option")
		out = append(out, batchQuestion{
			key: fmt.Sprintf("f%d", item.ID), item: item.ID, keys: keys,
			question: jev.Question{Type: jev.TypeChoice, Instructions: field + "\n" + optionInstructions(false), Criteria: criteria},
		})
	}
	return out
}

func collectPicks(items []ChoiceItem, questions []batchQuestion, answers map[string]jev.Answer) []ChoicePick {
	checked := map[int][]string{}
	best := map[int]string{}
	bestP := map[int]float64{}
	single := map[int]string{}
	for _, q := range questions {
		answer, ok := answers[q.key]
		if !ok {
			continue
		}
		if q.keys != nil {
			if label := q.keys[answer.Choice]; label != "" {
				single[q.item] = label
			} else if label := q.keys[bestKey(answer.Probabilities, q.keys)]; label != "" {
				single[q.item] = label
			}
			continue
		}
		if answer.Noul == nil {
			continue
		}
		if *answer.Noul > checkThreshold {
			checked[q.item] = append(checked[q.item], q.option)
		}
		if p, seen := bestP[q.item]; !seen || *answer.Noul > p {
			best[q.item], bestP[q.item] = q.option, *answer.Noul
		}
	}
	picks := make([]ChoicePick, 0, len(items))
	for _, item := range items {
		switch {
		case !item.Multiple && single[item.ID] != "":
			picks = append(picks, ChoicePick{ID: item.ID, Options: []string{single[item.ID]}})
		case item.Multiple && len(checked[item.ID]) > 0:
			picks = append(picks, ChoicePick{ID: item.ID, Options: checked[item.ID]})
		case item.Multiple && best[item.ID] != "":
			picks = append(picks, ChoicePick{ID: item.ID, Options: []string{best[item.ID]}})
		}
	}
	return picks
}
