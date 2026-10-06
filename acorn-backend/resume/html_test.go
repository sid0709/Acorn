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
