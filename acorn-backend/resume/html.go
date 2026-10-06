package resume

import (
	"fmt"
	"html"
	"strings"
)

const googleFontsHref = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;600&family=Lato:wght@400;700&family=Lora:wght@400;700&family=Merriweather:wght@400;700&family=Open+Sans:wght@400;600;700&family=PT+Serif:wght@400;700&family=Roboto+Mono:wght@400;600&family=Roboto:wght@400;500;700&family=Source+Sans+3:wght@400;600;700&family=Source+Serif+4:wght@400;600;700&display=swap"

func renderHTML(identity Identity, sections map[string]any, cfg map[string]any) string {
	theme := asRecord(cfg["theme"])
	font := asString(theme["font"])
	if font == "" {
		font = "Georgia"
	}
	accent := asString(theme["accent"])
	if accent == "" {
		accent = "#1f3a5f"
	}
	text := asString(theme["text"])
	if text == "" {
		text = "#1a1a1a"
	}
	align := asString(theme["headerAlign"])
	if align == "" {
		align = "center"
	}
	templateID := asString(cfg["templateId"])
	content := normalizeSections(sections)
	var body strings.Builder
	if strings.HasPrefix(templateID, "upload:") {
		body.WriteString(uploadedHTML(identity, content))
	} else {
		body.WriteString(builtinHTML(identity, content, templateID, accent, text, align))
	}
	width := "8.5in"
	if asString(theme["paper"]) == "a4" {
		width = "210mm"
	}
	return fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="%s"><style>
body{margin:0;background:#f4f4f5;color:%s;font-family:%s,serif;}
.page{width:%s;max-width:100%%;margin:24px auto;background:#fff;padding:0.6in;box-sizing:border-box;}
h1{font-size:24pt;margin:0 0 4px;font-weight:700;}
.contact{font-size:10.5pt;margin-bottom:16px;}
h2{font-size:12pt;letter-spacing:.08em;margin:18px 0 8px;}
p,li{font-size:10.5pt;line-height:1.35;}
ul{margin:4px 0 0 18px;padding:0;}
.two{display:flex;gap:24px;}
.side{width:34%%;}
.main{flex:1;}
</style></head><body><div class="page">%s</div></body></html>`,
		googleFontsHref, html.EscapeString(text), html.EscapeString(fontStack(font)), width, body.String())
}

func fontStack(name string) string {
	if strings.Contains(name, ",") {
		return name
	}
	if strings.Contains(name, " ") {
		return `"` + name + `"`
	}
	return name
}

func builtinHTML(identity Identity, content generatedContent, templateID, accent, text, align string) string {
	heading := headingRule(templateID, accent)
	nameColor := accent
	if templateID == "harvard" || templateID == "jakes" || templateID == "bold" || templateID == "dev" || templateID == "dev-compact" || templateID == "alternative" {
		nameColor = text
	}
	header := fmt.Sprintf(`<div style="text-align:%s">`, html.EscapeString(align))
	if templateID == "bold" {
		header = `<div style="border-top:8px solid ` + html.EscapeString(accent) + `;padding-top:12px;text-align:left">`
	}
	name := html.EscapeString(identity.FullName)
	if templateID == "alternative" {
		name = strings.ToUpper(name)
	}
	header += fmt.Sprintf(`<h1 style="color:%s">%s</h1>`, html.EscapeString(nameColor), name)
	if templateID == "bold" {
		header += `<div style="border-bottom:1px solid ` + html.EscapeString(accent) + `;margin:4px 0 8px"></div>`
	}
	header += `<div class="contact">` + html.EscapeString(strings.Join(nonempty(identity.Email, identity.Phone, identity.Location, identity.Linkedin), " · ")) + `</div></div>`

	summary := sectionHTML("SUMMARY", content.Summary, heading, templateID)
	skills := skillsHTML(content.Skills, heading, templateID)
	experience := experienceHTML(content.Experience, heading, templateID, accent)
	education := educationHTML(identity.Education, heading, templateID)

	if templateID == "sidebar" {
		return header + `<div class="two"><div class="side">` + skills + education + `</div><div class="main">` + summary + experience + `</div></div>`
	}
	return header + summary + skills + experience + education
}

func headingRule(templateID, accent string) string {
	switch templateID {
	case "accent-bar":
		return fmt.Sprintf("border-left:4px solid %s;padding-left:8px;", html.EscapeString(accent))
	case "harvard":
		return "text-align:center;border-top:1px solid currentColor;border-bottom:1px solid currentColor;padding:4px 0;"
	case "minimal", "modern", "bold", "alternative", "dev", "dev-compact":
		return "border:none;letter-spacing:.12em;"
	default:
		return fmt.Sprintf("border-bottom:1px solid %s;", html.EscapeString(accent))
	}
}

func sectionHTML(title, body, heading, templateID string) string {
	if strings.TrimSpace(body) == "" {
		return ""
	}
	label := title
	if templateID == "bold" || templateID == "dev" || templateID == "dev-compact" {
		label = strings.ToLower(strings.TrimSpace(title))
		label = strings.ToUpper(label[:1]) + label[1:]
	}
	return fmt.Sprintf(`<h2 style="%s">%s</h2><p>%s</p>`, heading, html.EscapeString(label), html.EscapeString(body))
}

func skillsHTML(groups []skillGroup, heading, templateID string) string {
	if len(groups) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf(`<h2 style="%s">Skills</h2>`, heading))
	for _, group := range groups {
		b.WriteString("<p><strong>" + html.EscapeString(group.Category) + ":</strong> " + html.EscapeString(strings.Join(group.Items, ", ")) + "</p>")
	}
	_ = templateID
	return b.String()
}

func experienceHTML(roles []previewCareer, heading, templateID, accent string) string {
	if len(roles) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf(`<h2 style="%s">Experience</h2>`, heading))
	for _, role := range roles {
		switch templateID {
		case "harvard", "jakes", "dev", "dev-compact":
			b.WriteString("<p><strong>" + html.EscapeString(role.Company) + "</strong>")
			if role.Location != "" {
				b.WriteString(" · " + html.EscapeString(role.Location))
			}
			b.WriteString("<br><em>" + html.EscapeString(role.Title) + "</em> " + html.EscapeString(role.Period) + "</p>")
		case "modern":
			b.WriteString("<p><span style=\"color:" + html.EscapeString(accent) + "\">" + html.EscapeString(role.Title) + "</span> · " + html.EscapeString(role.Company) + "<br>" + html.EscapeString(role.Period) + "</p>")
		default:
			b.WriteString("<p><strong>" + html.EscapeString(role.Title) + "</strong> · " + html.EscapeString(role.Company) + " · " + html.EscapeString(role.Period) + "</p>")
		}
		if len(role.Bullets) > 0 {
			b.WriteString("<ul>")
			for _, bullet := range role.Bullets {
				b.WriteString("<li>" + html.EscapeString(bullet) + "</li>")
			}
			b.WriteString("</ul>")
		}
	}
	return b.String()
}

func educationHTML(rows []EducationEntry, heading, templateID string) string {
	if len(rows) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf(`<h2 style="%s">Education</h2>`, heading))
	for _, row := range rows {
		b.WriteString("<p><strong>" + html.EscapeString(row.School) + "</strong> · " + html.EscapeString(row.Degree) + " · " + html.EscapeString(row.Period) + "</p>")
	}
	_ = templateID
	return b.String()
}

func uploadedHTML(identity Identity, content generatedContent) string {
	return builtinHTML(identity, content, "classic", "#1f3a5f", "#1a1a1a", "center")
}

func nonempty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}

func htmlFromDocx(data []byte) string {
	text := extractDocxText(data)
	paragraphs := strings.Split(text, "  ")
	var b strings.Builder
	b.WriteString(`<!doctype html><html><head><meta charset="utf-8"></head><body>`)
	for _, p := range paragraphs {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		b.WriteString("<p>" + html.EscapeString(p) + "</p>")
	}
	b.WriteString("</body></html>")
	return b.String()
}
