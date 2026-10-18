package resume

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/sid0709/OpenSeat/acorn-backend/openai"
)

// draftSchema is the reply shape of a fine-tune step: free text, wrapped so the call stays structured.
const draftSchema = `{"type":"object","additionalProperties":false,"properties":{"draft":{"type":"string"}},"required":["draft"]}`

// conversational is a model that can answer after earlier turns. One that cannot gets the turns
// flattened into a single message.
type conversational interface {
	Conversation(ctx context.Context, system string, turns []openai.Message, schema json.RawMessage) ([]byte, error)
}

func converse(ctx context.Context, model Model, system string, turns []openai.Message, schema json.RawMessage) ([]byte, error) {
	if chat, ok := model.(conversational); ok {
		return chat.Conversation(ctx, system, turns, schema)
	}
	if len(turns) == 1 {
		return model.JSON(ctx, system, turns[0].Content, schema)
	}
	var flat strings.Builder
	for _, turn := range turns {
		label := "Request"
		if turn.Role == openai.RoleAssistant {
			label = "Your earlier reply"
		}
		flat.WriteString(label + ":\n" + turn.Content + "\n\n")
	}
	return model.JSON(ctx, system, strings.TrimSpace(flat.String()), schema)
}

// plan is a run's configured steps with the pieces every step shares.
type plan struct {
	steps    []genStep
	system   string
	tokens   map[string]string
	identity Identity
	jd       string
	dynamic  bool
}

// buildPlan reads the config and checks it end to end: steps, schemas, and that every prompt's tokens
// resolve. It is the same check a run makes, so a bad prompt fails at enqueue instead of mid-run.
func buildPlan(cfg map[string]any, identity Identity, jobDescription string, structured bool) (plan, error) {
	steps, err := stepsFromConfig(cfg)
	if err != nil {
		return plan{}, err
	}
	p := plan{
		identity: identity,
		jd:       jobDescription,
		dynamic:  cfg["dynamicCareerTitles"] == true,
		tokens:   buildTokenMap(identity, jobDescription, ""),
	}
	for _, step := range steps {
		if structured && step.SkipForStructuredJobs && step.Kind != stepFinal {
			continue
		}
		p.steps = append(p.steps, step)
	}
	instruction, err := applyTokens(firstNonEmpty(asString(cfg["systemInstruction"]), defaultSystemInstruction), p.tokens)
	if err != nil {
		return plan{}, err
	}
	p.system = strings.Join(nonEmpty(instruction, contextBlock(identity), blankCareerNotice(identity)), "\n\n")
	for _, step := range p.steps {
		if _, err := p.userPrompt(step, ""); err != nil {
			return plan{}, fmt.Errorf("%w (%s)", err, step.Name)
		}
	}
	return p, nil
}

// userPrompt is the step's user message: its prompt with tokens filled in, then, for a final step, the
// schema it must answer to and, for Experience, the title policy.
func (p plan) userPrompt(step genStep, draft string) (string, error) {
	tokens := make(map[string]string, len(p.tokens)+len(generatedPurposes))
	for key, value := range p.tokens {
		tokens[key] = value
	}
	for _, purpose := range generatedPurposes {
		tokens["draft_"+purpose] = ""
	}
	tokens["draft_"+step.Purpose] = draft
	prompt, err := applyTokens(firstNonEmpty(step.Prompt, defaultPrompt[step.Purpose]), tokens)
	if err != nil {
		return "", err
	}
	if step.Kind != stepFinal {
		return prompt + "\n\nReturn ONLY a JSON object with your text in \"draft\".", nil
	}
	prompt += "\n\nReturn ONLY a JSON object that conforms to this JSON Schema:\n" + string(step.Schema)
	if step.Purpose == "experience" {
		prompt += titleGuidance(p.dynamic, p.jd, p.identity.Careers)
	}
	return prompt, nil
}

// runner executes a plan. Sections run in parallel; a section's steps run in order, each seeing the
// turns before it. The mutex guards the task, which the steps update as they finish.
type runner struct {
	svc   *Service
	model Model
	plan  plan
	mu    sync.Mutex
	task  *Task
	// sections holds each finished final step's output; it is task.Partial.
	sections map[string]any
}

func (r *runner) mark(index int, status string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.task.Progress.Steps {
		if r.task.Progress.Steps[i].Index == index {
			r.task.Progress.Steps[i].Status = status
		}
	}
	r.svc.store.putTask(snapshot(*r.task))
}

func (r *runner) finish(purpose string, output any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sections[purpose] = output
	r.task.Partial = cloneMap(r.sections)
	r.svc.store.putTask(snapshot(*r.task))
}

// snapshot is a copy of the task that later changes to the live one cannot reach.
func snapshot(task Task) Task {
	task.Progress.Steps = append([]ProgressStep(nil), task.Progress.Steps...)
	task.Partial = cloneMap(task.Partial)
	return task
}

// series runs one section's steps. indexes[i] is the progress index of steps[i].
func (r *runner) series(ctx context.Context, purpose string, steps []genStep, indexes []int) error {
	var turns []openai.Message
	var draft any
	for i, step := range steps {
		r.mark(indexes[i], "running")
		user, err := r.plan.userPrompt(step, formatDraft(draft))
		if err != nil {
			return err
		}
		schema, call := step.Schema, purpose
		if step.Kind != stepFinal {
			schema, call = json.RawMessage(draftSchema), purpose+"-draft"
		}
		turns = append(turns, openai.Message{Role: openai.RoleUser, Content: user})
		raw, err := converse(openai.WithCall(ctx, call), r.model, r.plan.system, turns, schema)
		if err != nil {
			return fmt.Errorf("%s: %w", step.Name, err)
		}
		var parsed any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return fmt.Errorf("%s: the model returned non-JSON output", step.Name)
		}
		turns = append(turns, openai.Message{Role: openai.RoleAssistant, Content: string(raw)})
		if step.Kind == stepFinal {
			draft = parsed
			r.finish(purpose, parsed)
		} else {
			draft = asString(asRecord(parsed)["draft"])
		}
		r.mark(indexes[i], "done")
	}
	return nil
}

// run executes every section that is not already written. A section is skipped when the checkpoint holds
// it, unless it is the one the run resumes from.
func (r *runner) run(ctx context.Context, resumeFrom string) error {
	type group struct {
		steps   []genStep
		indexes []int
	}
	groups := map[string]*group{}
	for i, step := range r.plan.steps {
		g := groups[step.Purpose]
		if g == nil {
			g = &group{}
			groups[step.Purpose] = g
		}
		g.steps = append(g.steps, step)
		g.indexes = append(g.indexes, progressIndex(i))
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(groups))
	for _, purpose := range generatedPurposes {
		g := groups[purpose]
		if g == nil {
			continue
		}
		r.mu.Lock()
		written := r.sections[purpose] != nil && resumeFrom != purpose
		r.mu.Unlock()
		if written {
			for _, index := range g.indexes {
				r.mark(index, "done")
			}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.series(ctx, purpose, g.steps, g.indexes); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		return err
	}
	return nil
}
