package profile

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	emailPattern    = regexp.MustCompile(`(?i)[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}`)
	phonePattern    = regexp.MustCompile(`(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]\d{3}[\s.\-]\d{4}|\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]?\d{2,4}){2,4}`)
	linkedinPattern = regexp.MustCompile(`(?i)(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com\s*/\s*in\s*/\s*([a-z0-9\-_%]+)`)
	githubPattern   = regexp.MustCompile(`(?i)(?:https?://)?(?:www\.)?github\.com\s*/\s*([a-z0-9\-_.]+)`)
	urlPattern      = regexp.MustCompile(`(?i)\b(?:https?://|www\.)[^\s)|•·,]+`)
)

const (
	linkedinBase = "https://www.linkedin.com/in/"
	githubBase   = "https://github.com/"
	maxNameRunes = 40
	minNameWords = 2
	maxNameWords = 4
)

// MergeResume copies name, contact, place, links, and timeline out of résumé text
// by reading its layout. Answers the résumé does not contain stay as they are.
func MergeResume(current Document, text string) (Document, error) {
	if len([]rune(strings.TrimSpace(text))) < minResumeRunes {
		return Document{}, ErrUnreadable
	}
	lines := nonEmptyLines(text)
	header := headerLines(lines)
	next := current
	if found := emailPattern.FindString(text); found != "" {
		next.Email = found
	}
	if found := phonePattern.FindString(text); found != "" {
		next.Phone = strings.TrimSpace(found)
	}
	linkedin := linkedinURL(text)
	github := githubURL(text)
	if linkedin != "" {
		next.Linkedin = linkedin
	}
	if github != "" {
		next.Github = github
	}
	if site := otherURL(text); site != "" {
		next.Portfolio = site
	}
	next = withPlace(next, placeFrom(header, lines))
	if name := nameFrom(header, lines); name != "" {
		next = withName(next, name, "", "", "")
	}
	if timeline := timelineFrom(lines); len(timeline) > 0 {
		next.Timeline = timeline
	}
	return normalize(next), nil
}

func withPlace(doc Document, found place) Document {
	if found.city != "" {
		doc.City = found.city
	}
	if found.state != "" {
		doc.State = found.state
	}
	if found.country != "" {
		doc.Country = found.country
	}
	if found.zip != "" {
		doc.Zip = found.zip
	}
	return doc
}

// withName sets the full name and its parts. Parts the caller does not know are split from the name.
func withName(doc Document, full, first, middle, last string) Document {
	full = personCase(strings.Join(strings.Fields(full), " "))
	if first == "" && last == "" {
		first, middle, last = splitPerson(full)
	}
	doc.FullName = full
	doc.FirstName = personCase(first)
	doc.MiddleName = personCase(middle)
	doc.LastName = personCase(last)
	return doc
}

func nonEmptyLines(text string) []string {
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r", ""), "\n") {
		line = strings.TrimRightFunc(line, unicode.IsSpace)
		if strings.TrimSpace(line) != "" {
			lines = append(lines, strings.TrimLeft(line, " "))
		}
	}
	return lines
}

// headerLines are the lines above the first heading: name, headline, and contact.
func headerLines(lines []string) []string {
	for index, line := range lines {
		if sectionOf(line) != sectionNone {
			return lines[:index]
		}
	}
	return lines
}

func otherURL(text string) string {
	for _, found := range urlPattern.FindAllString(text, -1) {
		lower := strings.ToLower(found)
		if strings.Contains(lower, "linkedin.com") || strings.Contains(lower, "github.com") {
			continue
		}
		found = strings.TrimRight(found, ".,;")
		if strings.HasPrefix(lower, "www.") {
			found = "https://" + found
		}
		return found
	}
	return ""
}

func nameFrom(header, lines []string) string {
	for _, group := range [][]string{header, lines} {
		for _, line := range group {
			if looksLikeName(line) {
				return line
			}
		}
	}
	return ""
}

func linkedinURL(text string) string {
	flat := strings.Join(strings.Fields(text), " ")
	match := linkedinPattern.FindStringSubmatch(flat)
	if len(match) < 2 || match[1] == "" {
		return ""
	}
	return linkedinBase + strings.Trim(match[1], "-_")
}

func githubURL(text string) string {
	match := githubPattern.FindStringSubmatch(text)
	if len(match) < 2 || match[1] == "" {
		return ""
	}
	return githubBase + strings.TrimRight(match[1], ".")
}

// looksLikeName is two to four capitalized words with no digits, contact, place, or job title.
func looksLikeName(line string) bool {
	line = strings.TrimSpace(line)
	if len([]rune(line)) > maxNameRunes || strings.ContainsAny(line, ",|@/:") || sectionOf(line) != sectionNone ||
		strings.ContainsAny(line, "0123456789") || countryName(line) != "" || roleWords.MatchString(line) {
		return false
	}
	words := strings.Fields(line)
	if len(words) < minNameWords || len(words) > maxNameWords {
		return false
	}
	for _, word := range words {
		first := []rune(word)[0]
		if !unicode.IsUpper(first) {
			return false
		}
	}
	return true
}

// personCase turns "STANLEY WANG" into "Stanley Wang" and leaves "McKenzie" alone.
func personCase(value string) string {
	if value == "" || value != strings.ToUpper(value) {
		return value
	}
	words := strings.Fields(strings.ToLower(value))
	for i, word := range words {
		runes := []rune(word)
		for j := range runes {
			if j == 0 || runes[j-1] == '-' || runes[j-1] == '\'' {
				runes[j] = unicode.ToUpper(runes[j])
			}
		}
		words[i] = string(runes)
	}
	return strings.Join(words, " ")
}

func splitPerson(name string) (string, string, string) {
	parts := strings.Fields(name)
	if len(parts) == 0 {
		return "", "", ""
	}
	if len(parts) == 1 {
		return parts[0], "", ""
	}
	if len(parts) == 2 {
		return parts[0], "", parts[1]
	}
	return parts[0], parts[1], strings.Join(parts[2:], " ")
}
