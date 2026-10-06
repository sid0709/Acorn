package resume

import (
	"fmt"
	"html"
	"strings"
)

// The résumé page as HTML, a Go port of Athens' live preview (resume-preview.tsx and friends).
// Theme sizes, margin, spacing, colors, and the section layout all come from the config.

// Sheet sizes for the preview page, so a short draft still reads as a full page.
const (
	letterWidth  = "8.5in"
	letterHeight = "11in"
	a4Width      = "210mm"
	a4Height     = "297mm"
)

// Fixed document chrome from Athens: gray for muted headings, a light rule between dev entries.
const (
	mutedHeadingColor = "#6b7280"
	devDividerColor   = "#e5e7eb"
	deskColor         = "#f4f4f5"
)

func renderHTML(identity Identity, sections map[string]any, cfg map[string]any) string {
	d := designFrom(cfg)
	if d.Uploaded {
		// The Word file holds its own layout; preview its content on the classic page.
		d.Template = templateByID(fallbackTemplateID)
	}
	content := normalizeSections(sections)
	width, height := letterWidth, letterHeight
	if d.Paper == "a4" {
		width, height = a4Width, a4Height
	}
	return fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="%s"><style>
body{margin:0;background:%s;}
.page{position:relative;overflow:hidden;width:%s;min-height:%s;max-width:100%%;margin:24px auto;background:#fff;box-sizing:border-box;padding:%gin;font-family:%s;color:%s;font-size:%s;line-height:%g;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
p{margin:0;}
ul{list-style:disc;margin:2px 0 0;padding-left:18px;}
li{margin-bottom:1px;break-inside:avoid;}
.row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;}
.meta{opacity:.72;white-space:nowrap;}
.head{break-after:avoid;}
.section{margin-bottom:%s;}
.entry{margin-bottom:%s;break-inside:avoid-page;}
.section>.entry:last-child,.section .entry:last-child{margin-bottom:0;}
</style></head><body><div class="page">%s</div></body></html>`,
		googleFontsHref, deskColor, width, height, d.Margin, cssValue(fontStack(d.Font)), cssValue(d.Text),
		pt(d.BaseSize), d.LineHeight, pt(d.SectionGap), pt(d.EntryGap), pageBody(identity, content, d))
}

func pageBody(identity Identity, content generatedContent, d pageDesign) string {
	t := d.Template
	var b strings.Builder
	if t.TopBar {
		b.WriteString(`<div style="height:10px;background:` + cssAttr(d.Accent) + `;border-radius:2px;margin-bottom:16px"></div>`)
	}
	if t.CornerAccent {
		b.WriteString(`<div style="position:absolute;top:0;right:0;width:55%;height:150px;background:` + tint(d.Accent, 8) +
			`;clip-path:polygon(100% 0,100% 100%,0 0)"></div>`)
	}
	b.WriteString(`<div style="position:relative">` + headerHTML(identity, d) + `</div><div style="position:relative">`)
	if t.Columns == 2 {
		var side, main strings.Builder
		for _, s := range d.Sections {
			if t.inSidebar(s.Type) {
				side.WriteString(sectionHTML(s, identity, content, d))
			} else {
				main.WriteString(sectionHTML(s, identity, content, d))
			}
		}
		direction := "row-reverse"
		if t.SidebarLeft {
			direction = "row"
		}
		sideStyle := fmt.Sprintf("width:%d%%;flex-shrink:0;", t.SidebarWidthPct)
		if t.SidebarTint {
			sideStyle += "background:" + tint(d.Accent, 6) + ";padding:14px;border-radius:4px;"
			if t.SidebarLeft {
				sideStyle += "margin-left:-6px;"
			}
		}
		b.WriteString(`<div style="display:flex;gap:24px;flex-direction:` + direction + `"><div style="` + sideStyle + `">` +
			side.String() + `</div><div style="flex:1;min-width:0">` + main.String() + `</div></div>`)
	} else {
		for _, s := range d.Sections {
			b.WriteString(sectionHTML(s, identity, content, d))
		}
	}
	b.WriteString(`</div>`)
	return b.String()
}

func headerHTML(identity Identity, d pageDesign) string {
	t := d.Template
	nameColor := d.Text
	if t.NameAccent {
		nameColor = d.Accent
	}
	spacing, transform := "0.01em", "none"
	if t.NameUppercase {
		spacing, transform = "0.04em", "uppercase"
	}
	name := orDefault(strings.TrimSpace(identity.FullName), "Your Name")
	nameEl := fmt.Sprintf(`<div style="font-size:%s;font-weight:700;letter-spacing:%s;color:%s;line-height:1.1;text-transform:%s">%s</div>`,
		pt(d.NameSize), spacing, cssAttr(nameColor), transform, html.EscapeString(name))

	contact := contactHTML(identity, d)
	if t.LabelGutter {
		return `<div style="display:flex;align-items:baseline;gap:24px;margin-bottom:18px">` + nameEl +
			`<div style="flex:1;min-width:0">` + contact + `</div></div>`
	}
	var b strings.Builder
	b.WriteString(`<div style="text-align:` + d.HeaderAlign + `;margin-bottom:18px">` + nameEl)
	if t.NameRule {
		b.WriteString(`<div style="border-bottom:1px solid ` + cssAttr(d.Accent) + `;opacity:.5;margin:8px 0"></div>`)
	}
	if contact != "" {
		top := "6px"
		if t.NameRule {
			top = "0"
		}
		b.WriteString(`<div style="margin-top:` + top + `">` + contact + `</div>`)
	}
	b.WriteString(`</div>`)
	return b.String()
}

type contactItem struct{ icon, text string }

func contactHTML(identity Identity, d pageDesign) string {
	t := d.Template
	items := []contactItem{}
	for _, item := range []contactItem{
		{iconMapPin, identity.Location}, {iconMail, identity.Email}, {iconPhone, identity.Phone}, {iconLinkedin, identity.Linkedin},
	} {
		if text := strings.TrimSpace(item.text); text != "" {
			items = append(items, contactItem{item.icon, text})
		}
	}
	if len(items) == 0 {
		return ""
	}
	justify := "flex-start"
	if d.HeaderAlign == "center" && !t.LabelGutter {
		justify = "center"
	}
	gap := "0"
	if t.ContactIcons {
		gap = "4px 16px"
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf(`<div style="font-size:%s;opacity:.85;display:flex;flex-wrap:wrap;gap:%s;justify-content:%s">`,
		pt(max(8, d.BaseSize-1.5)), gap, justify))
	iconPx := int(d.BaseSize*1.25 + 0.5)
	for i, item := range items {
		if t.ContactIcons {
			b.WriteString(fmt.Sprintf(`<span style="display:inline-flex;align-items:center;gap:4px">%s%s</span>`,
				contactIcon(item.icon, iconPx), html.EscapeString(item.text)))
			continue
		}
		if i > 0 {
			b.WriteString("&nbsp;&nbsp;·&nbsp;&nbsp;")
		}
		b.WriteString(html.EscapeString(item.text))
	}
	b.WriteString(`</div>`)
	return b.String()
}

// pt formats a point size for CSS.
func pt(n float64) string {
	return fmt.Sprintf("%gpt", n)
}

// cssAttr is a theme value placed inside a style attribute.
func cssAttr(value string) string {
	return html.EscapeString(cssValue(value))
}

// tint is the color at a low strength over white, for sidebar and corner washes.
func tint(color string, percent int) string {
	return fmt.Sprintf("color-mix(in srgb, %s %d%%, transparent)", cssAttr(color), percent)
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
