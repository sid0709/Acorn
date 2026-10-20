package agent

import (
	"encoding/json"
	"strings"
)

// replySchemaName is the name of the shape the model must answer in (see replySchemaFor).
const replySchemaName = "agent_step"

// replySchemaFor is the JSON shape the model must answer in. The provider's strict mode needs
// every property of an object present, so an action is one of several shapes, each with only
// the fields its kind uses: a click is {"kind", "x", "y", "check"}, not twelve fields with
// nine of them null. The model writes about a hundred tokens a second, so every field it need
// not write is time saved on every call, and a long plan is where it adds up.
//
// Observation comes first so the model reads the screen before it decides, and memo is its own
// scratchpad: the one thing carried from step to step. It is null when the notes did not
// change, so the model does not write them out again. An action's check is what the screen
// should show once that action has run, null where the model must look for itself; it exists
// only when a decision model checks the screen (checks). The "screen" of a point action and
// the "survey" action exist only when the run may look at a page as a survey (survey).
func replySchemaFor(survey, checks bool) json.RawMessage {
	return replySchemas[schemaIndex(survey, checks)]
}

func schemaIndex(survey, checks bool) int {
	index := 0
	if survey {
		index |= 1
	}
	if checks {
		index |= 2
	}
	return index
}

var replySchemas = func() [4]json.RawMessage {
	var out [4]json.RawMessage
	for index := range out {
		out[index] = buildReplySchema(index&1 != 0, index&2 != 0)
	}
	return out
}()

// Pieces of the schema, as ordered JSON text: the order of the properties is the order the
// model writes them in, so they are not built from a map.
const (
	schemaString         = `{"type": "string"}`
	schemaNullString     = `{"type": ["string", "null"]}`
	schemaNumber         = `{"type": "number"}`
	schemaNullNumber     = `{"type": ["number", "null"]}`
	schemaNullInteger    = `{"type": ["integer", "null"]}`
	schemaInteger        = `{"type": "integer"}`
	schemaNullBoolean    = `{"type": ["boolean", "null"]}`
	schemaStop           = `{"anyOf": [{"type": "null"}, {"type": "object", "additionalProperties": false, "required": ["reason", "problem", "action"], "properties": {"reason": {"type": "string", "enum": ["captcha", "verification", "verification_link", "identity", "document", "sign_in", "account_rejected", "page_problem", "other"]}, "problem": {"type": "string"}, "action": {"type": "string"}}}]}`
	schemaStatus         = `{"type": "string", "enum": ["working", "done", "need_person", "stuck"]}`
	schemaObjectOpening  = `{"type": "object", "additionalProperties": false, "required": [`
	schemaPropertiesOpen = `], "properties": {`
)

// field is one property of an object of the schema: its name and the schema of its value.
type field struct{ name, schema string }

// object is a strict object schema over fields, in order.
func object(fields ...field) string {
	var names, properties []string
	for _, f := range fields {
		names = append(names, `"`+f.name+`"`)
		properties = append(properties, `"`+f.name+`": `+f.schema)
	}
	return schemaObjectOpening + strings.Join(names, ", ") + schemaPropertiesOpen + strings.Join(properties, ", ") + `}}`
}

// kindField is the "kind" of an action shape: one or more kinds it covers.
func kindField(kinds ...string) field {
	quoted := make([]string, len(kinds))
	for i, kind := range kinds {
		quoted[i] = `"` + kind + `"`
	}
	return field{"kind", `{"type": "string", "enum": [` + strings.Join(quoted, ", ") + `]}`}
}

func buildReplySchema(survey, checks bool) json.RawMessage {
	// withCheck and withScreen add the optional fields to an action shape, at the places they
	// are written: the screen after the kind, the check last.
	withScreen := func(fields ...field) []field {
		if survey {
			fields = append([]field{fields[0], {"screen", schemaNullInteger}}, fields[1:]...)
		}
		return fields
	}
	withCheck := func(fields ...field) []field {
		if checks {
			fields = append(fields, field{"check", schemaNullString})
		}
		return fields
	}
	var shapes []string
	add := func(fields []field) { shapes = append(shapes, object(withCheck(fields...)...)) }
	add(withScreen(kindField(KindClick, KindDoubleClick, KindTripleClick, KindRightClick, KindHover), field{"x", schemaNumber}, field{"y", schemaNumber}))
	add(withScreen(kindField(KindChoose), field{"x", schemaNumber}, field{"y", schemaNumber}, field{"text", schemaString}))
	add(withScreen(kindField(KindUpload), field{"x", schemaNumber}, field{"y", schemaNumber}, field{"resume", schemaNullString}))
	add([]field{kindField(KindType), {"text", schemaString}, {"secret", schemaNullBoolean}})
	add([]field{kindField(KindKey), {"keys", schemaString}})
	add([]field{kindField(KindScroll), {"x", schemaNullNumber}, {"y", schemaNullNumber}, {"dx", schemaNumber}, {"dy", schemaNumber}})
	shapes = append(shapes, object(kindField(KindWait), field{"ms", schemaInteger}))
	if survey {
		shapes = append(shapes, object(kindField(KindSurvey)))
	}
	action := `{"anyOf": [` + strings.Join(shapes, ", ") + `]}`
	return json.RawMessage(object(
		field{"observation", schemaString},
		field{"memo", schemaNullString},
		field{"job", schemaNullString},
		field{"status", schemaStatus},
		field{"message", schemaString},
		field{"stop", schemaStop},
		field{"actions", `{"type": "array", "items": ` + action + `}`},
	))
}
