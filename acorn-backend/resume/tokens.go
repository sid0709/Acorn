package resume

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	tokenPattern   = regexp.MustCompile(`\{[a-zA-Z0-9_]+\}`)
	companyPattern = regexp.MustCompile(`(?i)\{company(\d+)\}`)
)

// buildTokenMap resolves the references a prompt may use: {job_description}, {job_skills},
// {career} (also {work_experience}), {source_resume} (also {identity}), and {companyN}, which is
// 1-based in profile order.
func buildTokenMap(identity Identity, jobDescription, jobSkills string) map[string]string {
	lines := make([]string, 0, len(identity.Careers))
	for _, career := range identity.Careers {
		head := strings.Join(nonEmpty(career.Title, career.Company, career.Period), " | ")
		if career.Description != "" && head != "" {
			head += " — " + career.Description
		}
		if line := firstNonEmpty(head, career.Description); line != "" {
			lines = append(lines, line)
		}
	}
	career := strings.Join(lines, "\n")
	source, _ := json.MarshalIndent(identity, "", "  ")
	tokens := map[string]string{
		"job_description": strings.TrimSpace(jobDescription),
		"job_skills":      strings.TrimSpace(jobSkills),
		"career":          career,
		"work_experience": career,
		"source_resume":   string(source),
		"identity":        string(source),
	}
	for i, entry := range identity.Careers {
		tokens[fmt.Sprintf("company%d", i+1)] = companyToken(entry)
	}
	return tokens
}

// companyToken is one role as a sentence: "Title at Company (period) — description".
func companyToken(c CareerEntry) string {
	head := c.Title
	switch {
	case c.Title != "" && c.Company != "":
		head = c.Title + " at " + c.Company
	case c.Title == "":
		head = c.Company
	}
	if c.Period != "" {
		if head != "" {
			head += " (" + c.Period + ")"
		} else {
			head = c.Period
		}
	}
	if c.Description != "" && head != "" {
		return head + " — " + c.Description
	}
	return firstNonEmpty(head, c.Description)
}

// applyTokens substitutes {token} references. A {companyN} past the profile's roles is empty;
// any other unknown token is an error, so a typo never reaches the model.
func applyTokens(text string, tokens map[string]string) (string, error) {
	text = strings.TrimSpace(text)
	known := make(map[string]string, len(tokens))
	for key, value := range tokens {
		known[key] = value
	}
	for _, match := range companyPattern.FindAllStringSubmatch(text, -1) {
		key := "company" + match[1]
		if _, ok := known[key]; !ok {
			known[key] = ""
		}
	}
	unresolved := map[string]bool{}
	out := tokenPattern.ReplaceAllStringFunc(text, func(match string) string {
		if value, ok := known[strings.ToLower(match[1:len(match)-1])]; ok {
			return value
		}
		unresolved[match] = true
		return match
	})
	if len(unresolved) > 0 {
		names := make([]string, 0, len(unresolved))
		for name := range unresolved {
			names = append(names, name)
		}
		sort.Strings(names)
		noun := "token"
		if len(names) > 1 {
			noun = "tokens"
		}
		return "", fmt.Errorf("%w: unresolved prompt %s: %s", ErrInvalid, noun, strings.Join(names, ", "))
	}
	return out, nil
}

func nonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}

// formatDraft is a finished step's output as it appears in a {draft_<section>} token.
func formatDraft(output any) string {
	switch typed := output.(type) {
	case nil:
		return ""
	case string:
		return typed
	default:
		raw, err := json.MarshalIndent(typed, "", "  ")
		if err != nil {
			return fmt.Sprint(typed)
		}
		return string(raw)
	}
}
