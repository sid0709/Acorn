package profile

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	emailPattern    = regexp.MustCompile(`(?i)[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}`)
	phonePattern    = regexp.MustCompile(`(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]\d{3}[\s.\-]\d{4}`)
	linkedinPattern = regexp.MustCompile(`(?i)(?:https?://)?(?:www\.)?linkedin\.com\s*/\s*in\s*/\s*([a-z0-9\-_%]+)`)
	githubPattern   = regexp.MustCompile(`(?i)https?://(?:www\.)?github\.com/[^\s)]+`)
	urlPattern      = regexp.MustCompile(`(?i)https?://[^\s)]+`)
	sectionPattern  = regexp.MustCompile(`(?i)^(experience|work experience|employment|education|skills|summary|objective|projects|contact)\b`)
	schoolPattern   = regexp.MustCompile(`(?i)\b(university|college|school|institute|academy)\b`)
	datePattern     = regexp.MustCompile(`(?i)((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})\s*(?:-|–|—|to)\s*(present|current|now|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2}))`)
	months          = []string{"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"}
)

// MergeResume copies name, contact, links, and timeline out of résumé text.
// Answers the résumé does not contain stay as they are.
func MergeResume(current Document, text string) (Document, error) {
	if len([]rune(strings.TrimSpace(text))) < minResumeRunes {
		return Document{}, ErrUnreadable
	}
	lines := nonEmptyLines(text)
	next := current
	if found := emailPattern.FindString(text); found != "" {
		next.Email = found
	}
	if found := phonePattern.FindString(text); found != "" {
		next.Phone = found
	}
	linkedin := linkedinURL(text)
	github := githubPattern.FindString(text)
	if linkedin != "" {
		next.Linkedin = linkedin
	}
	if github != "" {
		next.Github = github
	}
	if site := otherURL(text, linkedin, github); site != "" {
		next.Portfolio = site
	}
	if city, state, country, zip := placeFrom(lines); city != "" || state != "" || country != "" {
		if city != "" {
			next.City = city
		}
		if state != "" {
			next.State = state
		}
		if country != "" {
			next.Country = country
		}
		if zip != "" {
			next.Zip = zip
		}
	}
	if name := firstNameLine(lines); name != "" {
		next.FullName = name
		first, middle, last := splitPerson(name)
		next.FirstName = first
		next.MiddleName = middle
		next.LastName = last
	}
	if timeline := timelineFromLines(lines); len(timeline) > 0 {
		next.Timeline = timeline
	}
	return normalize(next), nil
}

func nonEmptyLines(text string) []string {
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func otherURL(text, linkedin, github string) string {
	for _, found := range urlPattern.FindAllString(text, -1) {
		if found != linkedin && found != github {
			return found
		}
	}
	return ""
}

func firstNameLine(lines []string) string {
	for _, line := range lines {
		if looksLikeName(line) {
			return line
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
	return "https://www.linkedin.com/in/" + strings.Trim(match[1], "-_")
}

func looksLikeName(line string) bool {
	if len(line) > 40 || strings.Contains(line, ",") || sectionPattern.MatchString(line) || emailPattern.MatchString(line) || strings.ContainsAny(line, "0123456789") || countryName(line) != "" {
		return false
	}
	words := strings.Fields(line)
	if len(words) < 2 || len(words) > 4 {
		return false
	}
	for _, word := range words {
		if word == "" || word[0] < 'A' || word[0] > 'Z' {
			return false
		}
	}
	return true
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

func timelineFromLines(lines []string) []Entry {
	section := "role"
	var entries []Entry
	for index, line := range lines {
		switch {
		case strings.HasPrefix(strings.ToLower(line), "education"):
			section = "education"
			continue
		case strings.HasPrefix(strings.ToLower(line), "experience"),
			strings.HasPrefix(strings.ToLower(line), "work experience"),
			strings.HasPrefix(strings.ToLower(line), "employment"):
			section = "role"
			continue
		}
		dated, ok := parseDates(line)
		if !ok {
			continue
		}
		previous, before := "", ""
		if index > 0 {
			previous = lines[index-1]
		}
		if index > 1 {
			before = lines[index-2]
		}
		inline := strings.TrimSpace(strings.TrimRight(strings.Split(line, dateHead(line))[0], "|•–—- "))
		title := inline
		org := previous
		if title == "" {
			title = previous
			org = before
		}
		if title == "" || sectionPattern.MatchString(title) {
			continue
		}
		kind := section
		if schoolPattern.MatchString(org) || schoolPattern.MatchString(title) {
			kind = "education"
		}
		if kind == "education" && schoolPattern.MatchString(title) {
			swapped := org
			if swapped == "" {
				swapped = title
			}
			org = title
			title = swapped
		}
		entries = append(entries, Entry{
			ID:         fmt.Sprintf("resume-%d", len(entries)),
			Kind:       kind,
			Title:      title,
			Org:        org,
			StartMonth: dated.startMonth,
			StartYear:  dated.startYear,
			EndMonth:   dated.endMonth,
			EndYear:    dated.endYear,
			Current:    dated.current,
		})
	}
	if len(entries) > 8 {
		return entries[:8]
	}
	return entries
}

func dateHead(line string) string {
	found := datePattern.FindString(line)
	if found == "" {
		return line
	}
	return found
}

type dates struct {
	startMonth string
	startYear  string
	endMonth   string
	endYear    string
	current    bool
}

func parseDates(line string) (dates, bool) {
	match := datePattern.FindStringSubmatch(line)
	if match == nil {
		return dates{}, false
	}
	current := regexp.MustCompile(`(?i)present|current|now`).MatchString(match[3])
	out := dates{
		startMonth: monthOf(match[1]),
		startYear:  match[2],
		current:    current,
	}
	if !current {
		out.endMonth = monthOf(match[3])
		out.endYear = match[4]
	}
	return out, true
}

func monthOf(token string) string {
	lower := strings.ToLower(token)
	for index, month := range months {
		if strings.Contains(lower, month) {
			return fmt.Sprintf("%d", index+1)
		}
	}
	return "1"
}
