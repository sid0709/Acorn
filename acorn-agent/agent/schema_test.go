package agent

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

type schemaObject struct {
	Type                 any                        `json:"type"`
	AdditionalProperties *bool                      `json:"additionalProperties"`
	Required             []string                   `json:"required"`
	Properties           map[string]json.RawMessage `json:"properties"`
	AnyOf                []json.RawMessage          `json:"anyOf"`
	Items                json.RawMessage            `json:"items"`
	Enum                 []string                   `json:"enum"`
}

func decodeSchema(t *testing.T, raw json.RawMessage) schemaObject {
	t.Helper()
	var out schemaObject
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("schema is not JSON: %v\n%s", err, raw)
	}
	return out
}

// actionShapes is the shapes an action may take in the schema, by the kinds each covers.
func actionShapes(t *testing.T, survey, checks bool) []schemaObject {
	t.Helper()
	top := decodeSchema(t, replySchemaFor(survey, checks))
	actions := decodeSchema(t, top.Properties["actions"])
	var shapes []schemaObject
	for _, raw := range decodeSchema(t, actions.Items).AnyOf {
		shapes = append(shapes, decodeSchema(t, raw))
	}
	return shapes
}

func kindsOf(t *testing.T, shape schemaObject) []string {
	t.Helper()
	return decodeSchema(t, shape.Properties["kind"]).Enum
}

func TestEveryShapeOfTheSchemaIsStrict(t *testing.T) {
	for _, survey := range []bool{false, true} {
		for _, checks := range []bool{false, true} {
			top := decodeSchema(t, replySchemaFor(survey, checks))
			want := []string{"observation", "memo", "job", "status", "message", "stop", "actions"}
			if survey {
				// What the model will not come back to is asked after the notes and before the plan.
				want = []string{"observation", "memo", "job", "status", "message", "stop", "settled", "actions"}
			}
			if !slices.Equal(top.Required, want) {
				t.Fatalf("answer fields = %v, want %v in this order", top.Required, want)
			}
			for _, shape := range actionShapes(t, survey, checks) {
				if shape.AdditionalProperties == nil || *shape.AdditionalProperties {
					t.Fatalf("a shape allows extra fields: %v", kindsOf(t, shape))
				}
				// The provider's strict mode needs every property listed as required.
				if len(shape.Required) != len(shape.Properties) {
					t.Fatalf("%v: required %v but properties %d", kindsOf(t, shape), shape.Required, len(shape.Properties))
				}
				for _, name := range shape.Required {
					if _, ok := shape.Properties[name]; !ok {
						t.Fatalf("%v requires %q, which it does not define", kindsOf(t, shape), name)
					}
				}
				if shape.Required[0] != "kind" {
					t.Fatalf("%v: kind must be written first", kindsOf(t, shape))
				}
			}
		}
	}
}

func TestTheSchemaCoversEveryKindTheModelMaySend(t *testing.T) {
	want := []string{KindClick, KindDoubleClick, KindTripleClick, KindRightClick, KindHover, KindChoose, KindUpload, KindType, KindKey, KindScroll, KindWait}
	for _, survey := range []bool{false, true} {
		var got []string
		for _, shape := range actionShapes(t, survey, true) {
			got = append(got, kindsOf(t, shape)...)
		}
		expected := slices.Clone(want)
		if survey {
			expected = append(expected, KindSurvey)
		}
		slices.Sort(got)
		slices.Sort(expected)
		if !slices.Equal(got, expected) {
			t.Fatalf("survey=%v: kinds %v, want %v", survey, got, expected)
		}
	}
}

func TestAnActionCarriesOnlyTheFieldsItsKindUses(t *testing.T) {
	fields := func(survey, checks bool, kind string) []string {
		for _, shape := range actionShapes(t, survey, checks) {
			if slices.Contains(kindsOf(t, shape), kind) {
				return shape.Required
			}
		}
		t.Fatalf("no shape for %s", kind)
		return nil
	}
	cases := []struct {
		survey, checks bool
		kind           string
		want           []string
	}{
		// A click names what it does beyond the click in every mode (next, send, or null).
		{false, true, KindClick, []string{"kind", "x", "y", "commit", "check"}},
		{false, false, KindClick, []string{"kind", "x", "y", "commit"}},
		{true, true, KindChoose, []string{"kind", "screen", "x", "y", "label", "text", "check"}},
		{true, true, KindClick, []string{"kind", "screen", "x", "y", "label", "commit", "check"}},
		{true, false, KindUpload, []string{"kind", "screen", "x", "y", "label", "resume"}},
		{false, true, KindType, []string{"kind", "text", "secret", "check"}},
		{false, true, KindKey, []string{"kind", "keys", "check"}},
		{false, true, KindScroll, []string{"kind", "x", "y", "dx", "dy", "check"}},
		{true, true, KindWait, []string{"kind", "ms"}},
		{true, true, KindSurvey, []string{"kind"}},
	}
	for _, c := range cases {
		if got := fields(c.survey, c.checks, c.kind); !slices.Equal(got, c.want) {
			t.Errorf("%s (survey=%v checks=%v): fields %v, want %v", c.kind, c.survey, c.checks, got, c.want)
		}
	}
}

// A compact action decodes into the same struct as a padded one: what it leaves out is nil.
func TestACompactAnswerParses(t *testing.T) {
	got, err := parseReply(`{"observation":"o","memo":null,"job":null,"status":"working","message":"m","stop":null,"actions":[{"kind":"click","x":10,"y":20,"check":null},{"kind":"type","text":"hi","secret":null,"check":"typed"},{"kind":"wait","ms":300}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Actions) != 3 || got.Actions[0].X == nil || *got.Actions[0].X != 10 || got.Actions[0].Screen != nil || got.Actions[2].Ms == nil {
		t.Fatalf("actions = %+v", got.Actions)
	}
}

func TestTheRunAsksForTheSchemaItsOptionsAllow(t *testing.T) {
	model := runWaitSteps(t, DefaultConfig(), 1)
	schema := string(model.requests[0].Schema)
	if strings.Contains(schema, `"screen"`) || strings.Contains(schema, KindSurvey) || strings.Contains(schema, `"check"`) {
		t.Fatalf("a run with no surveys and no checks was offered them:\n%s", schema)
	}

	checked := &scriptedModel{replies: []string{answerJSON("working", "ok", map[string]any{"kind": "wait", "ms": 100})}}
	a := newAgentWithScreen(t, checked, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	stepOK(t, a, start(t, a), observation(shot(t, 40)))
	if schema := string(checked.requests[0].Schema); !strings.Contains(schema, `"check"`) {
		t.Fatalf("a run with checks was not offered the check field:\n%s", schema)
	}
}

func TestALongPlanIsAllowedUpToTheDefaultCap(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.MaxActions < 25 {
		t.Fatalf("MaxActions = %d, want a plan of a whole form (25 or more)", cfg.MaxActions)
	}
	x, y, dy := 100.0, 100.0, 400.0
	var raw []modelAction
	for i := 0; i < cfg.MaxActions+2; i++ {
		if i%10 == 9 {
			raw = append(raw, modelAction{Kind: KindScroll, DY: &dy})
			continue
		}
		raw = append(raw, modelAction{Kind: KindClick, X: &x, Y: &y})
	}
	valid, dropped := checkActions(1, raw, Viewport{Width: 1280, Height: 800}, cfg.MaxActions, nil)
	if len(valid) != cfg.MaxActions || len(dropped) != 2 {
		t.Fatalf("valid = %d, dropped = %v; want %d valid and the 2 over the cap dropped", len(valid), dropped, cfg.MaxActions)
	}
}

func TestOnlyAResumeFileMayAutofillTheForm(t *testing.T) {
	model := runWaitSteps(t, DefaultConfig(), 1)
	system := model.requests[0].Messages[0].Text
	for _, want := range []string{"Only a résumé file may fill the form", "Autofill my application", "take the résumé one", "leave it alone and fill the fields by hand"} {
		if !strings.Contains(system, want) {
			t.Fatalf("the system prompt lacks %q", want)
		}
	}
	if strings.Contains(system, "stored on the site or in the applicant's profile there") {
		t.Fatal("the prompt still invites the site's own stored profile as an autofill source")
	}
}
