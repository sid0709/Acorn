package selector

import (
	"context"
	"fmt"
	"sync"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// maxQuestionsPerDecision splits a large batch into several Jev calls run in parallel,
// keeping each request well inside Jev's input budget.
const maxQuestionsPerDecision = 32

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
			res, err := g.decider.Decide(ctx, jev.Request{State: "Questions from one job application form.", Questions: questions})
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

func itemKey(id int) string { return fmt.Sprintf("item_%d", id) }
