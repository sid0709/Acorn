package resume

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
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

func extractPDFText(data []byte) string {
	raw := string(data)
	re := regexp.MustCompile(`\((?:\\.|[^\\)])*\)\s*Tj`)
	var parts []string
	for _, match := range re.FindAllString(raw, -1) {
		inner := match
		if i := strings.Index(inner, "("); i >= 0 {
			inner = inner[i+1:]
		}
		if j := strings.LastIndex(inner, ")"); j >= 0 {
			inner = inner[:j]
		}
		inner = strings.ReplaceAll(inner, `\n`, "\n")
		inner = strings.ReplaceAll(inner, `\r`, "")
		parts = append(parts, inner)
	}
	return collapseSpace(strings.Join(parts, "\n"))
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

func (s *Service) recommend(accountID, jobDescription string) (id, stack, reason string, err error) {
	jd := strings.ToLower(jobDescription)
	if strings.TrimSpace(jd) == "" {
		return "", "", "", fmt.Errorf("%w: job description is required", ErrInvalid)
	}
	bestScore := 0
	var best LibraryRow
	for _, row := range s.store.listLibrary(accountID) {
		full, ok := s.store.libraryItem(accountID, row.ID)
		if !ok {
			continue
		}
		hay := strings.ToLower(strings.Join([]string{full.Title, full.ExtractedText, strings.Join(full.Skills, " ")}, " "))
		score := 0
		for _, token := range strings.Fields(jd) {
			token = strings.Trim(token, ".,;:()")
			if len(token) < 4 {
				continue
			}
			if strings.Contains(hay, token) {
				score++
			}
		}
		if full.IsPrimary {
			score++
		}
		if score > bestScore {
			bestScore = score
			best = full
		}
	}
	if best.ID == "" {
		return "", "", "", ErrNoLibrary
	}
	reason = "Matched the posting to the " + best.Title + " library résumé."
	return best.ID, best.Title, reason, nil
}
