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

// bestResumeText keeps the longer of text the browser already read and text
// read from the file bytes. PDF.js text wins over a short or empty server extract.
func bestResumeText(name, provided string, data []byte) string {
	provided = strings.TrimSpace(provided)
	fresh := strings.TrimSpace(extractFileText(name, data))
	if utf8.RuneCountInString(fresh) > utf8.RuneCountInString(provided) {
		return fresh
	}
	return provided
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
