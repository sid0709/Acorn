package acorn

import (
	"encoding/json"
)

var actionTypes = []string{"fill", "upload", "resume_upload", "select_radio", "wait", "validate", "pause_for_review", "forbidden"}

// refillActionTypes fix flagged fields only: no waits, validation, or review pauses, plus clear.
var refillActionTypes = []string{"fill", "clear", "upload", "resume_upload", "select_radio", "forbidden"}

func nullable(kind string) map[string]any { return map[string]any{"type": []string{kind, "null"}} }

func planActionSchema(actions []string) map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"action":          map[string]any{"type": "string", "enum": actions},
			"element_index":   nullable("number"),
			"element_indexes": map[string]any{"type": []string{"array", "null"}, "items": map[string]any{"type": "number"}},
			"expected_label":  nullable("string"),
			"expected_role":   nullable("string"),
			"value":           nullable("string"),
			"file":            nullable("string"),
			"reason":          nullable("string"),
			"ms":              nullable("number"),
		},
		"required": []string{"action", "element_index", "element_indexes", "expected_label", "expected_role", "value", "file", "reason", "ms"},
	}
}

func mustSchema(value map[string]any) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		panic("acorn: schema: " + err.Error())
	}
	return data
}

func actionPlanSchema() json.RawMessage { return planSchemaFor(actionTypes) }

func refillPlanSchema() json.RawMessage { return planSchemaFor(refillActionTypes) }

func planSchemaFor(actions []string) json.RawMessage {
	return mustSchema(map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"goal":              map[string]any{"type": "string"},
			"actions":           map[string]any{"type": "array", "items": planActionSchema(actions)},
			"forbidden_actions": map[string]any{"type": "array", "items": planActionSchema(actions)},
			"validation": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"required_element_indexes": map[string]any{"type": "array", "items": map[string]any{"type": "number"}},
					"stop_before_submit":       map[string]any{"type": "boolean"},
				},
				"required": []string{"required_element_indexes", "stop_before_submit"},
			},
			"unresolved_items": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		},
		"required": []string{"goal", "actions", "forbidden_actions", "validation", "unresolved_items"},
	})
}

func proseAnswersSchema() json.RawMessage {
	return mustSchema(map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"answers": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"element_index": map[string]any{"type": "number"},
						"value":         map[string]any{"type": "string"},
					},
					"required": []string{"element_index", "value"},
				},
			},
		},
		"required": []string{"answers"},
	})
}

func identitySchema() json.RawMessage {
	return mustSchema(map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"classifications": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"element_index": map[string]any{"type": "number"},
						"kind":          map[string]any{"type": "string", "enum": []string{kindApplicationAI, kindWorkplaceAI, kindOther}},
					},
					"required": []string{"element_index", "kind"},
				},
			},
		},
		"required": []string{"classifications"},
	})
}

func extractJDSchema() json.RawMessage {
	return mustSchema(map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"hasJobDescription", "jobDescription", "reason"},
		"properties": map[string]any{
			"hasJobDescription": map[string]any{"type": "boolean"},
			"jobDescription":    nullable("string"),
			"reason":            map[string]any{"type": "string"},
		},
	})
}
