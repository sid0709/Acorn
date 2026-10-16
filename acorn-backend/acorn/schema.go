package acorn

import (
	"encoding/json"
)

func mustSchema(value map[string]any) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		panic("acorn: schema: " + err.Error())
	}
	return data
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
