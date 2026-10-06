package resume

import "strings"

// Font handling mirrors Athens and @acorn/shared/resume-fonts.ts: Google families load from
// one stylesheet, system names render where installed, and each name gets a generic fallback.

// googleFontsHref loads every Google family the font picker offers, with the weights the
// templates use (bold names and headings, semibold labels).
const googleFontsHref = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&family=Source+Serif+4:wght@400;600;700&family=Merriweather:wght@400;700&family=Lora:wght@400;600;700&family=PT+Serif:wght@400;700&family=Roboto+Mono:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap"

// defaultFont is the theme font when a config has none.
const defaultFont = "Georgia"

var serifFonts = map[string]bool{
	"Georgia": true, "Times New Roman": true, "Garamond": true, "Cambria": true,
	"Source Serif 4": true, "Merriweather": true, "Lora": true, "PT Serif": true,
}

var monoFonts = map[string]bool{"Roboto Mono": true, "JetBrains Mono": true}

// fontStack turns a picked font into a CSS font-family: multi-word names quoted, a generic
// fallback appended. A value that is already a stack (it has a comma) passes through.
func fontStack(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "sans-serif"
	}
	if strings.Contains(name, ",") {
		return name
	}
	generic := "sans-serif"
	if monoFonts[name] {
		generic = "monospace"
	} else if serifFonts[name] {
		generic = "serif"
	}
	if strings.ContainsAny(name, " \t") {
		name = `"` + name + `"`
	}
	return name + ", " + generic
}

// cssValue keeps a theme value inside its declaration. A <style> block is raw text, so HTML
// escaping would mangle quoted font names; instead drop what could end the rule or the block.
func cssValue(value string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case ';', '{', '}', '<', '>', '\\', '\n', '\r':
			return -1
		}
		return r
	}, value)
}
