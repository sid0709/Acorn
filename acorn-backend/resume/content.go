package resume

import (
	"encoding/json"
	"strings"
)

type generatedContent struct {
	Summary    string
	Skills     []skillGroup
	Experience []previewCareer
}

type skillGroup struct {
	Category string
	Items    []string
}

type previewCareer struct {
	Title    string
	Company  string
	Location string
	Period   string
	Bullets  []string
}

func normalizeSections(sections map[string]any) generatedContent {
	out := generatedContent{}
	if sections == nil {
		return out
	}
	summary := asRecord(sections["summary"])
	if text, ok := summary["summary"].(string); ok {
		out.Summary = strings.TrimSpace(text)
	}
	skills := asRecord(sections["skills"])
	if list, ok := skills["skills"].([]any); ok {
		for _, item := range list {
			row := asRecord(item)
			group := skillGroup{Category: asString(row["category"])}
			if items, ok := row["items"].([]any); ok {
				for _, entry := range items {
					group.Items = append(group.Items, asString(entry))
				}
			}
			if group.Category != "" || len(group.Items) > 0 {
				out.Skills = append(out.Skills, group)
			}
		}
	}
	exp := asRecord(sections["experience"])
	raw := exp["experiences"]
	if raw == nil {
		raw = exp["experience"]
	}
	if list, ok := raw.([]any); ok {
		for _, item := range list {
			row := asRecord(item)
			career := previewCareer{
				Title:    firstString(row, "title", "role"),
				Company:  asString(row["company"]),
				Location: asString(row["location"]),
				Period:   firstString(row, "period", "dates"),
			}
			if bullets, ok := row["bullets"].([]any); ok {
				for _, bullet := range bullets {
					career.Bullets = append(career.Bullets, asString(bullet))
				}
			}
			out.Experience = append(out.Experience, career)
		}
	}
	return out
}

func firstString(row map[string]any, keys ...string) string {
	for _, key := range keys {
		if text := asString(row[key]); text != "" {
			return text
		}
	}
	return ""
}

func asRecord(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	default:
		raw, err := json.Marshal(value)
		if err != nil {
			return map[string]any{}
		}
		var out map[string]any
		if json.Unmarshal(raw, &out) != nil {
			return map[string]any{}
		}
		return out
	}
}

func resumeSearchText(gen Generation) string {
	content := normalizeSections(gen.Sections)
	parts := []string{content.Summary}
	for _, group := range content.Skills {
		parts = append(parts, group.Category, strings.Join(group.Items, " "))
	}
	for _, role := range content.Experience {
		parts = append(parts, role.Title, role.Company, strings.Join(role.Bullets, " "))
	}
	return strings.ToLower(strings.Join(parts, " "))
}
