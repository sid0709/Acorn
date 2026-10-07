package acorn

import (
	"context"
	"testing"
)

// pillTree is a planner tree with a Yes / No pill question, a race checkbox group,
// a long country list, and a text box.
const pillTree = `form[1]
 label[2] for=q1 "Have you ever been employed by Acme?"
 ul[3] role=list aria-label="Have you ever been employed by Acme?"
  button[4] type=button "Yes"
  button[5] type=button "No"
 fieldset[10]
  label[11] "Select the races you identify with."
  input[12] type=checkbox
  input[13] type=checkbox
 select[20] "Country"
 input[30] type=text aria-label="City"`

const pillFields = `{"fields":[
 {"element_index":4,"kind":"buttons","label":"Have you ever been employed by Acme?","section":"","required":true,"answered":false,"options":[{"label":"Yes","element_index":4},{"label":"No","element_index":5}],"options_complete":true},
 {"element_index":12,"kind":"checkbox","label":"Select the races you identify with.","section":"","required":false,"answered":true,"options":[{"label":"Asian","element_index":12},{"label":"White","element_index":13}],"options_complete":true},
 {"element_index":20,"kind":"select","label":"Country","section":"","required":true,"answered":false,"options":[{"label":"Afghanistan","element_index":null}],"options_complete":false},
 {"element_index":30,"kind":"text","label":"City","section":"","required":false,"answered":false,"options":[],"options_complete":true},
 {"element_index":99,"kind":"text","label":"Invented","section":"","required":false,"answered":false,"options":[],"options_complete":true},
 {"element_index":4,"kind":"buttons","label":"Duplicate","section":"","required":false,"answered":false,"options":[],"options_complete":true}
]}`

func TestDiscoverFieldsKeepsOnlyTreeNodes(t *testing.T) {
	service := New(&fakeModel{replies: []string{pillFields}})
	fields, err := service.DiscoverFields(context.Background(), pillTree)
	if err != nil {
		t.Fatal(err)
	}
	if len(fields) != 4 {
		t.Fatalf("got %d fields, want 4 (the invented id and the duplicate dropped): %+v", len(fields), fields)
	}
	pill := fields[0]
	if pill.Kind != fieldButtons || len(pill.OptionIndexes) != 2 || pill.OptionIndexes[1] != 5 {
		t.Fatalf("pill field = %+v, want buttons with option nodes 4 and 5", pill)
	}
	if country := fields[2]; country.Kind != fieldDropdown || len(country.Options) != 0 {
		t.Fatalf("country = %+v, want a dropdown left to the runtime", country)
	}
}

func TestOptionsOfDropsNodesUnlessEveryOptionHasOne(t *testing.T) {
	ids := map[int]bool{4: true}
	five := 5
	four := 4
	labels, nodes := optionsOf([]discoveredOption{{Label: "Yes", ElementIndex: &four}, {Label: "No", ElementIndex: &five}}, ids)
	if len(labels) != 2 || nodes != nil {
		t.Fatalf("labels %v nodes %v, want both labels and no nodes (5 is not in the tree)", labels, nodes)
	}
}

// fixedPicker answers every choice field from picks.
type fixedPicker struct{ picks map[int][]string }

func (f fixedPicker) PickChoices(context.Context, string, []ChoiceQuestion) (map[int][]string, error) {
	return f.picks, nil
}

func TestFastPlanFromTreeTargetsTheChosenOption(t *testing.T) {
	picker := fixedPicker{picks: map[int][]string{4: {"No"}, 12: {"Asian"}}}
	service := New(&fakeModel{replies: []string{pillFields}}).WithClassifier(&fakeClassifier{}).WithPicker(picker)
	result, err := service.FastPlanFromTree(context.Background(), "", pillTree, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Fields) != 4 {
		t.Fatalf("result carries %d fields, want 4", len(result.Fields))
	}
	steps := map[int]string{}
	for _, row := range result.Plan["actions"].([]any) {
		action := row.(map[string]any)
		steps[int(action["element_index"].(float64))] = action["value"].(string)
	}
	if steps[5] != "No" || steps[4] != "" {
		t.Fatalf("pill steps = %v, want the No button (5) selected and nothing on Yes (4)", steps)
	}
	// The race group already shows an answer, so the box not chosen is cleared too.
	if steps[12] != "true" || steps[13] != "false" {
		t.Fatalf("race steps = %v, want Asian (12) checked and White (13) cleared", steps)
	}
}
