package resume

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	stepFinal    = "final"
	stepFineTune = "fine-tune"

	defaultSystemInstruction = "You are an expert resume writer."
)

// generatedPurposes are the sections the model writes. Education comes from the profile.
var generatedPurposes = []string{"summary", "skills", "experience"}

var purposeLabel = map[string]string{"summary": "Summary", "skills": "Skills", "experience": "Experience"}

// genStep is one configured model call. A fine-tune step refines its purpose's running draft;
// the final step returns the section as JSON that matches its schema.
type genStep struct {
	ID                    string
	Purpose               string
	Kind                  string
	Name                  string
	Prompt                string
	Schema                json.RawMessage
	SkipForStructuredJobs bool
}

func isPurpose(value string) bool {
	for _, purpose := range generatedPurposes {
		if purpose == value {
			return true
		}
	}
	return false
}

// defaultSteps is one final step per section, running the default prompts.
func defaultSteps() []any {
	steps := make([]any, 0, len(generatedPurposes))
	for _, purpose := range generatedPurposes {
		steps = append(steps, map[string]any{
			"id":      "default-" + purpose,
			"purpose": purpose,
			"kind":    stepFinal,
			"name":    purposeLabel[purpose] + " (final)",
			"prompt":  defaultPrompt[purpose],
			"schema":  defaultSchema[purpose],
		})
	}
	return steps
}

// withDefaultSteps fills what an older or partial config left out: the step list itself, and the
// prompt and schema of a final step saved blank. Blank prompts are how the website's own defaults
// travel, so the editor shows the prompt that actually runs.
func withDefaultSteps(cfg map[string]any) map[string]any {
	list := asList(cfg["steps"])
	if len(list) == 0 {
		cfg["steps"] = defaultSteps()
		return cfg
	}
	steps := make([]any, 0, len(list))
	finals := map[string]bool{}
	for _, raw := range list {
		row := cloneMap(asRecord(raw))
		purpose := asString(row["purpose"])
		if asString(row["kind"]) == stepFinal && isPurpose(purpose) {
			finals[purpose] = true
			if asString(row["prompt"]) == "" {
				row["prompt"] = defaultPrompt[purpose]
			}
			if asString(row["schema"]) == "" {
				row["schema"] = defaultSchema[purpose]
			}
		}
		steps = append(steps, row)
	}
	for _, purpose := range generatedPurposes {
		if finals[purpose] {
			continue
		}
		for _, raw := range defaultSteps() {
			if row := raw.(map[string]any); row["purpose"] == purpose {
				steps = append(steps, row)
			}
		}
	}
	cfg["steps"] = steps
	return cfg
}

// stepsFromConfig reads and checks the configured steps: every section has exactly one final step,
// a fine-tune step has a prompt, and every schema is JSON.
func stepsFromConfig(cfg map[string]any) ([]genStep, error) {
	cfg = withDefaultSteps(cloneMap(cfg))
	finals := map[string]int{}
	var steps []genStep
	for i, raw := range asList(cfg["steps"]) {
		row := asRecord(raw)
		step := genStep{
			ID:                    asString(row["id"]),
			Purpose:               asString(row["purpose"]),
			Kind:                  asString(row["kind"]),
			Name:                  asString(row["name"]),
			Prompt:                asString(row["prompt"]),
			SkipForStructuredJobs: row["skipForStructuredJobs"] == true,
		}
		if !isPurpose(step.Purpose) {
			return nil, fmt.Errorf("%w: step %d writes an unknown section", ErrInvalid, i+1)
		}
		if step.Kind != stepFinal {
			step.Kind = stepFineTune
		}
		if step.Name == "" {
			step.Name = fmt.Sprintf("Step %d", i+1)
		}
		if step.Kind == stepFinal {
			finals[step.Purpose]++
			schema, err := finalSchema(step.Purpose, asString(row["schema"]))
			if err != nil {
				return nil, fmt.Errorf("%w: %s has an invalid output schema", ErrInvalid, step.Name)
			}
			step.Schema = schema
		} else if step.Prompt == "" {
			return nil, fmt.Errorf("%w: %s needs a prompt", ErrInvalid, step.Name)
		}
		steps = append(steps, step)
	}
	for _, purpose := range generatedPurposes {
		if finals[purpose] != 1 {
			return nil, fmt.Errorf("%w: %s must have exactly one final step (found %d)", ErrInvalid, strings.ToLower(purposeLabel[purpose]), finals[purpose])
		}
	}
	return steps, nil
}

// finalSchema is the step's own schema, or the section's default when it has none. Objects that
// do not say whether extra keys are allowed get additionalProperties:false, which strict
// structured output requires.
func finalSchema(purpose, text string) (json.RawMessage, error) {
	if text == "" {
		text = defaultSchema[purpose]
	}
	var schema any
	if err := json.Unmarshal([]byte(text), &schema); err != nil {
		return nil, err
	}
	if _, ok := schema.(map[string]any); !ok {
		return nil, fmt.Errorf("schema is not an object")
	}
	closeObjects(schema)
	return json.Marshal(schema)
}

func closeObjects(node any) {
	switch typed := node.(type) {
	case map[string]any:
		if _, isObject := typed["properties"]; isObject {
			if _, set := typed["additionalProperties"]; !set {
				typed["additionalProperties"] = false
			}
		}
		for _, child := range typed {
			closeObjects(child)
		}
	case []any:
		for _, child := range typed {
			closeObjects(child)
		}
	}
}
