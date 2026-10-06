package resume

// Built-in template layouts. Mirrors RESUME_TEMPLATES in @acorn/shared/resume-templates.ts
// (and Athens): the frontend picks by id and applies a template's default font and accent;
// the renderer reads the structure below.

type templateDef struct {
	ID               string
	Columns          int
	Sidebar          []string // section types in the sidebar (two-column only)
	SidebarLeft      bool
	SidebarWidthPct  int
	SidebarTint      bool
	Heading          string // underline | bar | plain | centered-rules
	HeadingAlign     string // left | center
	ExperienceLayout string // default | standard | single-line | modern | harvard | jakes | two-col-entry | dev
	ContactIcons     bool
	NameAccent       bool // name in the accent color; otherwise the text color
	HeadingTitleCase bool // "Experience" instead of "EXPERIENCE"
	HeadingMuted     bool // headings in gray instead of the section color
	HeadingText      bool // headings and skill categories in the text color
	NameUppercase    bool
	NameRule         bool
	TopBar           bool
	CornerAccent     bool
	LabelGutter      bool // section heading in a left gutter, body on the right
}

const fallbackTemplateID = "classic"

func single(t templateDef) templateDef {
	t.Columns = 1
	return t
}

var templates = map[string]templateDef{
	"classic":    single(templateDef{ID: "classic", Heading: "underline", HeadingAlign: "left", ExperienceLayout: "default", NameAccent: true}),
	"centered":   single(templateDef{ID: "centered", Heading: "underline", HeadingAlign: "center", ExperienceLayout: "default", NameAccent: true}),
	"minimal":    single(templateDef{ID: "minimal", Heading: "plain", HeadingAlign: "left", ExperienceLayout: "default", NameAccent: true}),
	"accent-bar": single(templateDef{ID: "accent-bar", Heading: "bar", HeadingAlign: "left", ExperienceLayout: "default", NameAccent: true}),
	"sidebar": {
		ID: "sidebar", Columns: 2, Sidebar: []string{"skills", "education"}, SidebarLeft: true, SidebarWidthPct: 34, SidebarTint: true,
		Heading: "underline", HeadingAlign: "left", ExperienceLayout: "default", NameAccent: true,
	},
	"standard": single(templateDef{ID: "standard", Heading: "underline", HeadingAlign: "left", ExperienceLayout: "standard", ContactIcons: true, NameAccent: true}),
	"compact":  single(templateDef{ID: "compact", Heading: "underline", HeadingAlign: "left", ExperienceLayout: "single-line", ContactIcons: true, NameAccent: true}),
	"modern":   single(templateDef{ID: "modern", Heading: "plain", HeadingAlign: "left", ExperienceLayout: "modern", ContactIcons: true, NameAccent: true}),
	"harvard":  single(templateDef{ID: "harvard", Heading: "centered-rules", HeadingAlign: "center", ExperienceLayout: "harvard"}),
	"jakes":    single(templateDef{ID: "jakes", Heading: "underline", HeadingAlign: "left", ExperienceLayout: "jakes"}),
	"bold": single(templateDef{
		ID: "bold", Heading: "plain", HeadingAlign: "left", ExperienceLayout: "single-line", ContactIcons: true,
		HeadingTitleCase: true, NameRule: true, TopBar: true, HeadingText: true,
	}),
	"alternative": single(templateDef{
		ID: "alternative", Heading: "plain", HeadingAlign: "left", ExperienceLayout: "two-col-entry", ContactIcons: true,
		HeadingMuted: true, NameUppercase: true, CornerAccent: true,
	}),
	"dev-compact": single(templateDef{ID: "dev-compact", Heading: "plain", HeadingAlign: "left", ExperienceLayout: "dev", HeadingTitleCase: true, HeadingMuted: true}),
	"dev":         single(templateDef{ID: "dev", Heading: "plain", HeadingAlign: "left", ExperienceLayout: "dev", HeadingTitleCase: true, HeadingMuted: true, LabelGutter: true}),
}

func templateByID(id string) templateDef {
	if t, ok := templates[id]; ok {
		return t
	}
	return templates[fallbackTemplateID]
}

func (t templateDef) inSidebar(sectionType string) bool {
	for _, s := range t.Sidebar {
		if s == sectionType {
			return true
		}
	}
	return false
}
