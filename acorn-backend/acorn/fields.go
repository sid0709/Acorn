package acorn

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// fieldDropdown is a custom dropdown or a choice whose options the tree does not
// all show. The fast planner leaves it to the runtime, which opens it and reads
// the live options.
const fieldDropdown = "dropdown"

// discoveredKinds are the field kinds the text model may report.
var discoveredKinds = []string{
	fieldText, fieldTextarea, fieldSelect, fieldRadio, fieldCheckbox, fieldToggle, fieldButtons, fieldFile, fieldDropdown,
}

// treeNodeID matches a node id in the planner tree: tag[id].
var treeNodeID = regexp.MustCompile(`\[(\d+)\]`)

// discoveredField is one question as the text model lists it.
type discoveredField struct {
	ElementIndex    int                `json:"element_index"`
	Kind            string             `json:"kind"`
	Label           string             `json:"label"`
	Section         string             `json:"section"`
	Required        bool               `json:"required"`
	Answered        bool               `json:"answered"`
	Options         []discoveredOption `json:"options"`
	OptionsComplete bool               `json:"options_complete"`
}

type discoveredOption struct {
	Label        string `json:"label"`
	ElementIndex *int   `json:"element_index"`
}

func fieldsSchema() json.RawMessage {
	option := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"label":         map[string]any{"type": "string"},
			"element_index": nullable("number"),
		},
		"required": []string{"label", "element_index"},
	}
	return mustSchema(map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"fields": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"element_index":    map[string]any{"type": "number"},
						"kind":             map[string]any{"type": "string", "enum": discoveredKinds},
						"label":            map[string]any{"type": "string"},
						"section":          map[string]any{"type": "string"},
						"required":         map[string]any{"type": "boolean"},
						"answered":         map[string]any{"type": "boolean"},
						"options":          map[string]any{"type": "array", "items": option},
						"options_complete": map[string]any{"type": "boolean"},
					},
					"required": []string{"element_index", "kind", "label", "section", "required", "answered", "options", "options_complete"},
				},
			},
		},
		"required": []string{"fields"},
	})
}

// DiscoverFields has the text model list the page's questions from the planner
// tree: which controls exist, how they group into questions, and each option's
// own node. Ids the tree does not contain are dropped, so a misread id never
// becomes a step.
func (s *Service) DiscoverFields(ctx context.Context, pureTree string) ([]FormField, error) {
	if strings.TrimSpace(pureTree) == "" {
		return nil, fmt.Errorf("%w: pureTree is required", ErrInvalid)
	}
	ctx, cancel := context.WithTimeout(ctx, fieldsTimeout)
	defer cancel()
	text, err := s.ask(ctx, PurposeFields, fieldsSystem, "Page form tree:\n"+pureTree, fieldsSchema())
	if err != nil {
		return nil, fmt.Errorf("discover fields: %w", err)
	}
	var out struct {
		Fields []discoveredField `json:"fields"`
	}
	if err := decodeModelJSON(text, &out); err != nil {
		return nil, fmt.Errorf("discover fields: %w", err)
	}
	return toFormFields(out.Fields, treeNodeIDs(pureTree)), nil
}

// FastPlanFromTree lists the page's fields from the planner tree, then plans them
// like FastPlan. The result carries the fields it found.
func (s *Service) FastPlanFromTree(ctx context.Context, applicant, pureTree string, page map[string]any) (AnalyzeResult, error) {
	if s.classifier == nil || s.picker == nil {
		return AnalyzeResult{}, ErrFastUnavailable
	}
	fields, err := s.DiscoverFields(ctx, pureTree)
	if err != nil {
		return AnalyzeResult{}, err
	}
	result, err := s.FastPlan(ctx, applicant, fields, page)
	result.Fields = fields
	return result, err
}

func treeNodeIDs(pureTree string) map[int]bool {
	ids := map[int]bool{}
	for _, match := range treeNodeID.FindAllStringSubmatch(pureTree, -1) {
		if id, err := strconv.Atoi(match[1]); err == nil {
			ids[id] = true
		}
	}
	return ids
}

// toFormFields keeps the fields whose control is in the tree. A choice field keeps
// its option nodes only when every one is in the tree; otherwise the runtime finds
// the option by its label. A choice whose options are not all shown becomes a
// dropdown, which the runtime reads live.
func toFormFields(found []discoveredField, ids map[int]bool) []FormField {
	fields := make([]FormField, 0, len(found))
	seen := map[int]bool{}
	for _, f := range found {
		label := strings.TrimSpace(f.Label)
		if !ids[f.ElementIndex] || seen[f.ElementIndex] || label == "" {
			continue
		}
		seen[f.ElementIndex] = true
		field := FormField{
			ElementIndex: f.ElementIndex, Kind: f.Kind, Label: label, Section: strings.TrimSpace(f.Section),
			Required: f.Required, Answered: f.Answered,
		}
		if isChoiceKind(f.Kind) {
			if !f.OptionsComplete {
				field.Kind = fieldDropdown
			} else {
				field.Options, field.OptionIndexes = optionsOf(f.Options, ids)
			}
		}
		fields = append(fields, field)
	}
	return fields
}

func isChoiceKind(kind string) bool {
	switch kind {
	case fieldSelect, fieldRadio, fieldCheckbox, fieldButtons:
		return true
	}
	return false
}

// optionsOf is the option labels, and their node ids when every option has one in the tree.
func optionsOf(options []discoveredOption, ids map[int]bool) ([]string, []int) {
	labels := make([]string, 0, len(options))
	indexes := make([]int, 0, len(options))
	for _, option := range options {
		label := strings.TrimSpace(option.Label)
		if label == "" {
			continue
		}
		labels = append(labels, label)
		if option.ElementIndex != nil && ids[*option.ElementIndex] {
			indexes = append(indexes, *option.ElementIndex)
		}
	}
	if len(indexes) != len(labels) {
		indexes = nil
	}
	return labels, indexes
}
