package resume

import (
	"encoding/json"
	"math"
	"strings"
)

// The document design read from a résumé config: the theme and the ordered section layout.
// Field names match ResumeTheme / ResumeLayoutSection in @acorn/shared/resume-config.ts.
// Every value is optional; a missing or out-of-range one falls back to the default below.

type sectionDesign struct {
	Type      string
	Title     string
	Color     string
	TitleSize float64 // pt
	BodySize  float64 // pt
}

type pageDesign struct {
	Template    templateDef
	Uploaded    bool
	Font        string
	Accent      string
	Text        string
	HeaderAlign string
	Paper       string
	BaseSize    float64 // pt
	NameSize    float64 // pt
	TitleSize   float64 // pt
	Margin      float64 // in
	SectionGap  float64 // pt between sections
	EntryGap    float64 // pt between roles and schools
	LineHeight  float64 // unitless
	Sections    []sectionDesign
}

// Defaults and limits, shared with the editor (RESUME_THEME_LIMITS in resume-config.ts).
var (
	baseSizeRange   = numRange{def: 10.5, min: 7, max: 16}
	nameSizeRange   = numRange{def: 24, min: 14, max: 40}
	titleSizeRange  = numRange{def: 12, min: 8, max: 20}
	marginRange     = numRange{def: 0.6, min: 0.25, max: 1.5}
	sectionGapRange = numRange{def: 10.5, min: 0, max: 36}
	entryGapRange   = numRange{def: 7.5, min: 0, max: 24}
	lineHeightRange = numRange{def: 1.42, min: 1, max: 2}
)

const (
	defaultAccent = "#1f3a5f"
	defaultText   = "#1a1a1a"
)

// sectionOrder is the layout when a config has none, and fills in types a layout leaves out.
var sectionOrder = []string{"summary", "skills", "experience", "education"}

var sectionLabel = map[string]string{
	"summary": "Summary", "skills": "Skills", "experience": "Experience", "education": "Education",
}

type numRange struct{ def, min, max float64 }

func (r numRange) read(value any) float64 {
	n, ok := asNumber(value)
	if !ok || n <= 0 && r.min > 0 {
		return r.def
	}
	return math.Max(r.min, math.Min(r.max, n))
}

func designFrom(cfg map[string]any) pageDesign {
	theme := asRecord(cfg["theme"])
	templateID := asString(cfg["templateId"])
	d := pageDesign{
		Template:    templateByID(templateID),
		Uploaded:    strings.HasPrefix(templateID, "upload:"),
		Font:        orDefault(asString(theme["font"]), defaultFont),
		Accent:      orDefault(asString(theme["accent"]), defaultAccent),
		Text:        orDefault(asString(theme["text"]), defaultText),
		HeaderAlign: "center",
		Paper:       "letter",
		BaseSize:    baseSizeRange.read(theme["baseSize"]),
		NameSize:    nameSizeRange.read(theme["nameSize"]),
		TitleSize:   titleSizeRange.read(theme["titleSize"]),
		Margin:      marginRange.read(theme["margin"]),
		SectionGap:  sectionGapRange.read(theme["sectionGap"]),
		EntryGap:    entryGapRange.read(theme["entryGap"]),
		LineHeight:  lineHeightRange.read(theme["lineHeight"]),
	}
	if asString(theme["headerAlign"]) == "left" {
		d.HeaderAlign = "left"
	}
	if asString(theme["paper"]) == "a4" {
		d.Paper = "a4"
	}
	d.Sections = sectionsFrom(asList(cfg["layout"]), d)
	return d
}

// sectionsFrom keeps the layout's order, drops hidden sections, and appends any type the
// layout never mentions so an older config still shows every section.
func sectionsFrom(layout []any, d pageDesign) []sectionDesign {
	seen := map[string]bool{}
	out := []sectionDesign{}
	for _, item := range layout {
		row := asRecord(item)
		kind := asString(row["type"])
		if sectionLabel[kind] == "" || seen[kind] {
			continue
		}
		seen[kind] = true
		if hidden, _ := row["hidden"].(bool); hidden {
			continue
		}
		out = append(out, sectionDesign{
			Type:      kind,
			Title:     orDefault(asString(row["title"]), sectionLabel[kind]),
			Color:     orDefault(asString(row["titleColor"]), d.Accent),
			TitleSize: numRange{def: d.TitleSize, min: titleSizeRange.min, max: titleSizeRange.max}.read(row["titleSize"]),
			BodySize:  numRange{def: d.BaseSize, min: baseSizeRange.min, max: baseSizeRange.max}.read(row["bodySize"]),
		})
	}
	for _, kind := range sectionOrder {
		if !seen[kind] {
			out = append(out, sectionDesign{
				Type: kind, Title: sectionLabel[kind], Color: d.Accent, TitleSize: d.TitleSize, BodySize: d.BaseSize,
			})
		}
	}
	return out
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func asNumber(value any) (float64, bool) {
	switch n := value.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

// asList reads an array whether it arrived as JSON ([]any) or from the database driver.
func asList(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var out []any
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	return out
}
