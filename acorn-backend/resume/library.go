package resume

import (
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

func extractFileText(name string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".docx":
		return extractDocxText(data)
	case ".pdf":
		return extractPDFText(data)
	default:
		return collapseSpace(string(data))
	}
}

// minReadableRunes is the least text a résumé read can hold and still be one.
const minReadableRunes = 40

// minReadableShare is the least share of a text's characters that a person reads
// (letters, digits, spacing, punctuation, symbols). A PDF whose fonts store glyph
// numbers rather than characters reads as control codes and stray bytes instead.
const minReadableShare = 0.9

// readableText reports whether text reads as words a person wrote, whatever its
// language, rather than raw glyph codes pulled out of a file.
func readableText(text string) bool {
	total, reading := 0, 0
	for _, r := range text {
		total++
		switch {
		case r == utf8.RuneError, unicode.Is(unicode.Co, r):
		case unicode.IsControl(r) && !unicode.IsSpace(r):
		case unicode.IsLetter(r), unicode.IsDigit(r), unicode.IsSpace(r), unicode.IsPunct(r), unicode.IsSymbol(r):
			reading++
		}
	}
	return total >= minReadableRunes && float64(reading) >= minReadableShare*float64(total)
}

// bestResumeText is the résumé's text as a person reads it, whatever the file's
// format: the first readable of the texts already read (the browser's PDF.js text
// first), else the server's own read of the file. Length decides nothing: a PDF
// whose fonts keep glyph numbers reads as long junk. Empty when nothing is readable.
func bestResumeText(name string, data []byte, read ...string) string {
	for _, text := range read {
		if text = strings.TrimSpace(text); readableText(text) {
			return text
		}
	}
	if fresh := strings.TrimSpace(extractFileText(name, data)); readableText(fresh) {
		return fresh
	}
	return ""
}

func analyzeText(text string) []string {
	skills := map[string]bool{}
	for _, token := range strings.Fields(text) {
		clean := strings.Trim(token, ".,;:()[]")
		if looksLikeSkill(clean) {
			skills[clean] = true
		}
	}
	out := make([]string, 0, len(skills))
	for skill := range skills {
		out = append(out, skill)
	}
	return out
}

func looksLikeSkill(token string) bool {
	if len(token) < 2 || len(token) > 24 {
		return false
	}
	letters := 0
	for _, r := range token {
		if unicode.IsLetter(r) {
			letters++
		}
	}
	if letters < 2 {
		return false
	}
	upper := 0
	for _, r := range token {
		if unicode.IsUpper(r) {
			upper++
		}
	}
	return upper > 0
}
