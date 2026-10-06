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
	if strings.TrimSpace(jobDescription) == "" {
		return "", "", "", fmt.Errorf("%w: job description is required", ErrInvalid)
	}
	jdWords := matchWords(jobDescription)
	bestScore := 0
	bestSkills := 0
	var best LibraryRow
	for _, row := range s.store.listLibrary(accountID) {
		if row.Source != "" && row.Source != "uploaded" {
			continue
		}
		score, skillHits := scoreLibraryMatch(row, jdWords)
		if score > bestScore || (score == bestScore && score > 0 && skillHits > bestSkills) {
			bestScore = score
			bestSkills = skillHits
			best = row
		}
	}
	if best.ID == "" || bestScore == 0 {
		return "", "", "", ErrNoLibrary
	}
	reason = "Matched the posting to the " + best.Title + " library résumé."
	if bestSkills > 0 {
		reason = fmt.Sprintf("%s %d analyzed skill%s from that résumé appear in the posting.", reason, bestSkills, plural(bestSkills))
	}
	return best.ID, best.Title, reason, nil
}

// scoreLibraryMatch ranks one uploaded library file against a posting.
// The title is the tech stack from the parent folder. SkillProfile is the
// library Analyze result (name, category, level). Résumé body text is not scanned.
func scoreLibraryMatch(row LibraryRow, jdWords []string) (score, skillHits int) {
	for _, token := range stackTokens(row.Title) {
		if phraseInWords(jdWords, token) {
			score += 10
		}
	}
	for _, skill := range row.SkillProfile {
		name := strings.TrimSpace(skill.Name)
		if name == "" || !phraseInWords(jdWords, matchWords(name)) {
			continue
		}
		weight := skill.Level
		if weight < skillLevelMin {
			weight = skillLevelMin
		}
		if skill.Category == "hard" || skill.Category == "devops" {
			weight *= 2
		}
		score += weight
		skillHits++
	}
	if score > 0 && row.IsPrimary {
		score++
	}
	return score, skillHits
}

func stackTokens(title string) [][]string {
	title = strings.ReplaceAll(title, " - ", "+")
	parts := strings.FieldsFunc(title, func(r rune) bool {
		return r == '+' || r == '/' || r == '|' || r == '&' || r == ',' || r == ';'
	})
	var tokens [][]string
	for _, part := range parts {
		part = strings.Trim(part, " -\t")
		words := matchWords(part)
		if len(words) > 0 {
			tokens = append(tokens, words)
		}
	}
	return tokens
}

func matchWords(text string) []string {
	compact := strings.Builder{}
	flush := func(out *[]string) {
		if compact.Len() == 0 {
			return
		}
		*out = append(*out, compact.String())
		compact.Reset()
	}
	var words []string
	for _, r := range strings.ToLower(text) {
		if r == '.' || r == '-' || r == '_' {
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '+' || r == '#' {
			compact.WriteRune(r)
			continue
		}
		flush(&words)
	}
	flush(&words)
	return words
}

func phraseInWords(hay []string, phrase []string) bool {
	if len(phrase) == 0 || len(phrase) > len(hay) {
		return false
	}
	for i := 0; i <= len(hay)-len(phrase); i++ {
		match := true
		for j, word := range phrase {
			if hay[i+j] != word {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
