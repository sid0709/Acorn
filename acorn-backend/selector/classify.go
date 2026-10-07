package selector

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	// maxQuestionsPerDecision splits a large batch into several Jev calls run in parallel,
	// keeping each request well inside Jev's input budget.
	maxQuestionsPerDecision = 32

	// formState is the state every form-field decision is asked against.
	formState = "Questions from one job application form."
	// pickOneQuestion is PickOne's single question key.
	pickOneQuestion = "pick_one"
)

// ClassifyEach asks one choice question per item — "which of these kinds is this?" —
// and returns each item's most probable kind. Items run in parallel batches.
func (g *Gateway) ClassifyEach(ctx context.Context, instructions string, kinds map[string]string, items map[int]string) (map[int]string, error) {
	if len(items) == 0 || len(kinds) == 0 {
		return map[int]string{}, nil
	}
	ids := make([]int, 0, len(items))
	for id := range items {
		ids = append(ids, id)
	}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		out      = make(map[int]string, len(items))
		firstErr error
	)
	for start := 0; start < len(ids); start += maxQuestionsPerDecision {
		batch := ids[start:min(start+maxQuestionsPerDecision, len(ids))]
		wg.Add(1)
		go func() {
			defer wg.Done()
			questions := make(map[string]jev.Question, len(batch))
			for _, id := range batch {
				questions[itemKey(id)] = jev.Question{
					Type:         jev.TypeChoice,
					Instructions: instructions + "\nQuestion: " + clip(items[id], maxDescription),
					Criteria:     kinds,
				}
			}
			res, err := g.decider.Decide(ctx, jev.Request{State: formState, Questions: questions})
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			for _, id := range batch {
				if answer, ok := res.Answers[itemKey(id)]; ok && answer.Choice != "" {
					out[id] = answer.Choice
				}
			}
		}()
	}
	wg.Wait()
	if len(out) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// PickOne asks a single choice question whose options are the items themselves —
// "which one of these is it?" — so Jev weighs them side by side instead of judging
// each alone, and returns the most probable item's id.
func (g *Gateway) PickOne(ctx context.Context, instructions string, items map[int]string) (int, error) {
	if len(items) == 0 || len(items) > jev.MaxChoiceOptions {
		return 0, fmt.Errorf("%w: pick one needs 1 to %d items, got %d", ErrInvalid, jev.MaxChoiceOptions, len(items))
	}
	ids := make(map[string]int, len(items))
	criteria := make(map[string]string, len(items))
	for id, description := range items {
		key := itemKey(id)
		ids[key] = id
		criteria[key] = clip(description, maxDescription)
	}
	res, err := g.decider.Decide(openai.WithCall(ctx, "pick-one"), jev.Request{
		State: formState,
		Questions: map[string]jev.Question{pickOneQuestion: {
			Type:         jev.TypeChoice,
			Instructions: instructions,
			Criteria:     criteria,
		}},
	})
	if err != nil {
		return 0, fmt.Errorf("pick one: %w", err)
	}
	answer, ok := res.Answers[pickOneQuestion]
	if !ok {
		return 0, errors.New("jev returned no pick-one answer")
	}
	if id, listed := ids[answer.Choice]; listed {
		return id, nil
	}
	if key := bestKey(answer.Probabilities, criteria); key != "" {
		return ids[key], nil
	}
	return 0, errors.New("jev picked no listed item")
}

func itemKey(id int) string { return fmt.Sprintf("item_%d", id) }
