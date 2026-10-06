package resume

import (
	"fmt"
	"html"
	"regexp"
	"strings"
)

// One section of the page — heading plus body — following the layout order, colors, and sizes.
// Ports Athens' section-block, section-body, and experience-entry.

func sectionHTML(s sectionDesign, identity Identity, content generatedContent, d pageDesign) string {
	color := headingColor(d, s.Color)
	body := sectionBody(s, identity, content, d, color)
	if body == "" {
		return ""
	}
	heading := headingHTML(d.Template, s, color)
	if d.Template.LabelGutter {
		return `<div class="section" style="display:flex;gap:24px"><div style="width:22%;flex-shrink:0">` + heading +
			`</div><div style="flex:1;min-width:0">` + body + `</div></div>`
	}
	return `<div class="section">` + heading + body + `</div>`
}

func headingColor(d pageDesign, sectionColor string) string {
	switch {
	case d.Template.HeadingMuted:
		return mutedHeadingColor
	case d.Template.HeadingText:
		return d.Text
	default:
		return sectionColor
	}
}

func headingHTML(t templateDef, s sectionDesign, color string) string {
	c := cssAttr(color)
	style := fmt.Sprintf("font-size:%s;font-weight:700;color:%s;margin-bottom:7px;text-align:%s;break-after:avoid;",
		pt(s.TitleSize), c, t.HeadingAlign)
	if t.HeadingTitleCase {
		style += "text-transform:none;letter-spacing:0;"
	} else {
		style += "text-transform:uppercase;letter-spacing:.08em;"
	}
	switch t.Heading {
	case "underline":
		style += "border-bottom:1.5px solid " + c + ";padding-bottom:3px;"
	case "bar":
		style += "border-left:3px solid " + c + ";padding-left:8px;"
	case "centered-rules":
		style += "text-align:center;border-top:1px solid " + c + ";border-bottom:1px solid " + c + ";padding:3px 0;"
	default:
		style += "padding-bottom:1px;"
	}
	return `<div style="` + style + `">` + html.EscapeString(s.Title) + `</div>`
}

func sectionBody(s sectionDesign, identity Identity, content generatedContent, d pageDesign, color string) string {
	size := pt(s.BodySize)
	meta := pt(max(8, s.BodySize-1))
	var b strings.Builder
	switch s.Type {
	case "summary":
		if strings.TrimSpace(content.Summary) == "" {
			return ""
		}
		return `<p style="text-align:justify;font-size:` + size + `">` + rich(content.Summary) + `</p>`
	case "skills":
		if len(content.Skills) == 0 {
			return ""
		}
		b.WriteString(`<div style="font-size:` + size + `">`)
		for _, g := range content.Skills {
			b.WriteString(`<div style="margin-bottom:3px"><span style="font-weight:700;color:` + cssAttr(color) + `">` +
				rich(g.Category) + `:</span> ` + rich(strings.Join(g.Items, ", ")) + `</div>`)
		}
	case "experience":
		if len(content.Experience) == 0 {
			return ""
		}
		b.WriteString(`<div style="font-size:` + size + `">`)
		for _, role := range content.Experience {
			b.WriteString(`<div class="entry">` + experienceEntry(role, d.Template.ExperienceLayout, color, meta) + `</div>`)
		}
	case "education":
		if len(identity.Education) == 0 {
			return ""
		}
		b.WriteString(`<div style="font-size:` + size + `">`)
		for _, row := range identity.Education {
			b.WriteString(`<div class="entry"><div class="row"><span style="font-weight:700">` + html.EscapeString(orDefault(row.School, "School")) +
				`</span><span style="opacity:.7;white-space:nowrap;font-size:` + meta + `">` + html.EscapeString(row.Period) + `</span></div>`)
			if row.Degree != "" {
				b.WriteString(`<div style="font-style:italic;color:` + cssAttr(color) + `">` + html.EscapeString(row.Degree) + `</div>`)
			}
			b.WriteString(`</div>`)
		}
	default:
		return ""
	}
	b.WriteString(`</div>`)
	return b.String()
}

// experienceEntry arranges one role the way the template's format does.
func experienceEntry(c previewCareer, layout, accent, metaSize string) string {
	title := html.EscapeString(orDefault(c.Title, "Role"))
	company := html.EscapeString(orDefault(c.Company, "Company"))
	location := html.EscapeString(c.Location)
	dates := html.EscapeString(c.Period)
	datesLoc := html.EscapeString(strings.Join(nonempty(c.Period, c.Location), ", "))
	metaSpan := func(text string, italic bool) string {
		style := "font-size:" + metaSize + ";"
		if italic {
			style += "font-style:italic;"
		}
		return `<span class="meta" style="` + style + `">` + text + `</span>`
	}
	row := func(left, right string) string { return `<div class="row">` + left + right + `</div>` }
	bold := func(text string) string { return `<span style="font-weight:700">` + text + `</span>` }
	bullets := bulletList(c.Bullets, "2px 0 0")

	var head string
	switch layout {
	case "standard":
		head = `<div style="font-weight:700">` + title + `</div>` + row(bold(company), metaSpan(datesLoc, false))
	case "single-line":
		parts := []string{title, company}
		parts = append(parts, nonempty(location, dates)...)
		head = `<div style="font-weight:700">` + strings.Join(parts, "&nbsp; | &nbsp;") + `</div>`
	case "modern":
		head = `<div><span style="font-weight:700;color:` + cssAttr(accent) + `">` + title + `</span>` + bold(" | "+company) + `</div>` +
			`<div style="opacity:.6;font-size:` + metaSize + `">` + datesLoc + `</div>`
	case "harvard":
		head = row(bold(company), metaSpan(location, false)) + row(bold(title), metaSpan(dates, false))
	case "jakes":
		head = row(bold(company), metaSpan(location, false)) + row(`<span style="font-style:italic">`+title+`</span>`, metaSpan(dates, true))
	case "two-col-entry":
		var paras strings.Builder
		for _, bullet := range c.Bullets {
			paras.WriteString(`<p style="margin:0 0 2px;text-align:justify;break-inside:avoid">` + rich(bullet) + `</p>`)
		}
		where := bold(company)
		if location != "" {
			where += `<span style="opacity:.7"> | ` + location + `</span>`
		}
		return `<div style="display:flex;gap:20px"><div style="width:32%;flex-shrink:0"><div style="font-weight:700">` + title +
			`</div><div style="opacity:.6;font-size:` + metaSize + `">` + dates + `</div></div><div style="flex:1;min-width:0"><div style="margin-bottom:3px">` +
			where + `</div>` + paras.String() + `</div></div>`
	case "dev":
		return `<div style="border-bottom:1px solid ` + devDividerColor + `;padding-bottom:8px"><div class="head">` + bold(company) +
			` <span style="opacity:.55">` + title + `</span></div>` + bulletList(c.Bullets, "3px 0 0") +
			`<div style="opacity:.5;font-size:` + metaSize + `;margin-top:4px">` + datesLoc + `</div></div>`
	default:
		head = row(bold(title), metaSpan(dates, false)) +
			`<div style="font-style:italic;color:` + cssAttr(accent) + `;margin-bottom:2px">` + company + `</div>`
	}
	return `<div class="head">` + head + `</div>` + bullets
}

func bulletList(bullets []string, margin string) string {
	if len(bullets) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(`<ul style="margin:` + margin + `">`)
	for _, bullet := range bullets {
		b.WriteString("<li>" + rich(bullet) + "</li>")
	}
	b.WriteString("</ul>")
	return b.String()
}

var boldSpan = regexp.MustCompile(`\*\*([^*]+?)\*\*`)

// rich escapes text and turns the model's **bold** spans into <strong>.
func rich(text string) string {
	return boldSpan.ReplaceAllString(html.EscapeString(text), "<strong>$1</strong>")
}
