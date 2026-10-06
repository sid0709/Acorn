package resume

import (
	"strings"
	"testing"
)

func TestRenderHTMLFontFamily(t *testing.T) {
	cases := map[string]string{
		"Inter":           "font-family:Inter, sans-serif;",
		"Source Sans 3":   `font-family:"Source Sans 3", sans-serif;`,
		"Times New Roman": `font-family:"Times New Roman", serif;`,
		"Merriweather":    "font-family:Merriweather, serif;",
		"JetBrains Mono":  `font-family:"JetBrains Mono", monospace;`,
		`ui-monospace, "SF Mono", Menlo, monospace`: `font-family:ui-monospace, "SF Mono", Menlo, monospace;`,
	}
	for font, want := range cases {
		cfg := map[string]any{"templateId": "classic", "theme": map[string]any{"font": font}}
		got := renderHTML(Identity{FullName: "Ada"}, nil, cfg)
		if !strings.Contains(got, want) {
			t.Errorf("font %q: want %q in the page style", font, want)
		}
	}
}

func TestRenderHTMLStyleCannotBreakOut(t *testing.T) {
	cfg := map[string]any{"theme": map[string]any{"font": `x;}</style><script>alert(1)</script>`}}
	got := renderHTML(Identity{FullName: "Ada"}, nil, cfg)
	if strings.Contains(got, "<script>") || strings.Count(got, "</style>") != 1 {
		t.Fatalf("theme values escaped the style block:\n%s", got)
	}
}

func sampleSections() map[string]any {
	return map[string]any{
		"summary": map[string]any{"summary": "Builds **reliable** systems."},
		"skills":  map[string]any{"skills": []any{map[string]any{"category": "Go", "items": []any{"HTTP"}}}},
		"experience": map[string]any{"experiences": []any{map[string]any{
			"title": "Engineer", "company": "Acme", "period": "2020 – 2024", "bullets": []any{"Shipped"},
		}}},
	}
}

func TestRenderHTMLFollowsLayout(t *testing.T) {
	cfg := map[string]any{
		"templateId": "classic",
		"theme":      map[string]any{"sectionGap": 20, "entryGap": 4, "lineHeight": 1.6, "margin": 0.9, "baseSize": 11},
		"layout": []any{
			map[string]any{"type": "experience", "title": "Work History", "titleColor": "#7b1e3b", "titleSize": 15, "bodySize": 9.5},
			map[string]any{"type": "summary", "title": "Profile"},
			map[string]any{"type": "skills", "hidden": true},
		},
	}
	identity := Identity{FullName: "Ada", Education: []EducationEntry{{School: "MIT", Degree: "BS", Period: "2016"}}}
	got := renderHTML(identity, sampleSections(), cfg)

	work, profile, school := strings.Index(got, "Work History"), strings.Index(got, ">Profile<"), strings.Index(got, ">MIT<")
	if work < 0 || profile < 0 || school < 0 || !(work < profile && profile < school) {
		t.Fatalf("want Work History, then Profile, then the education the layout left out; got positions %d %d %d", work, profile, school)
	}
	if strings.Contains(got, ">HTTP<") || strings.Contains(got, "Go:</span>") {
		t.Error("hidden skills section was rendered")
	}
	for _, want := range []string{
		".section{margin-bottom:20pt;}", ".entry{margin-bottom:4pt;", "line-height:1.6;", "padding:0.9in;",
		"font-size:15pt;font-weight:700;color:#7b1e3b", `<div style="font-size:9.5pt">`, "<strong>reliable</strong>",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("want %q in the page", want)
		}
	}
}

func TestRenderHTMLClampsAndDefaults(t *testing.T) {
	d := designFrom(map[string]any{"theme": map[string]any{"baseSize": 99, "margin": -1, "sectionGap": 0}})
	if d.BaseSize != baseSizeRange.max || d.Margin != marginRange.def || d.SectionGap != 0 {
		t.Fatalf("got base %v margin %v gap %v", d.BaseSize, d.Margin, d.SectionGap)
	}
	if len(d.Sections) != len(sectionOrder) || d.Sections[0].Type != "summary" {
		t.Fatalf("missing layout should give the default order, got %+v", d.Sections)
	}
}

func TestRenderHTMLTemplateStructure(t *testing.T) {
	cases := map[string]string{
		"sidebar":     "flex-direction:row",
		"bold":        "height:10px;background:",
		"alternative": "clip-path:polygon",
		"dev":         "width:22%;flex-shrink:0",
		"harvard":     "border-top:1px solid",
		"standard":    "<svg",
	}
	identity := Identity{FullName: "Ada", Email: "ada@example.com"}
	for id, want := range cases {
		got := renderHTML(identity, sampleSections(), map[string]any{"templateId": id})
		if !strings.Contains(got, want) {
			t.Errorf("template %s: want %q", id, want)
		}
	}
}
