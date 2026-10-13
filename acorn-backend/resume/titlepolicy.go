package resume

import (
	"fmt"
	"strings"
	"unicode"
)

// titleGuidance is the mandatory block appended to the Experience prompt. With dynamic titles off the
// profile's titles stay exactly as written; with them on the model proposes concise conventional ones.
func titleGuidance(dynamic bool, jobDescription string, careers []CareerEntry) string {
	sequence := authoritativeSequence(careers)
	if !dynamic {
		return `

TITLE POLICY (mandatory — dynamic career titles disabled):
- Keep each experience job title EXACTLY as given in the candidate profile.
- Do not rename, rephrase, shorten, expand, or tailor titles to the job description.
- You may rewrite bullets only; company names and dates stay as given.
` + sequence
	}
	jd := strings.TrimSpace(jobDescription)
	if jd == "" {
		jd = "(no job description provided)"
	}
	return `

TITLE POLICY (mandatory — dynamic career titles enabled):
Target job description:
<<<
` + jd + `
>>>

` + sequence + `
- Propose one concise, conventional résumé title per role (e.g. "Senior Backend Engineer").
- Align specialization to that role's responsibilities and the target JD when supported by the experience.
- You may infer seniority freely, but the overall sequence must remain humanly plausible chronologically.
- Domain transitions (e.g. Java → backend → full stack, or data → AI) are allowed only when each role's experience supports them.
- PROHIBITED: slash or keyword stacking such as "Senior/Staff Backend/Java Engineer", pipe-joined titles, or comma-stuffed keyword lists.
- Preserve company names and dates from the authoritative sequence; rewrite bullets as usual.`
}

func authoritativeSequence(careers []CareerEntry) string {
	lines := "(no careers on profile)"
	if len(careers) > 0 {
		rows := make([]string, 0, len(careers))
		for i, c := range careers {
			parts := nonEmpty(fmt.Sprintf("#%d", i+1), firstNonEmpty(c.Title, "(untitled)"))
			if c.Company != "" {
				parts = append(parts, "@ "+c.Company)
			}
			if c.Period != "" {
				parts = append(parts, "("+c.Period+")")
			}
			row := strings.Join(parts, " ")
			if c.Description != "" {
				row += " — " + c.Description
			}
			rows = append(rows, row)
		}
		lines = strings.Join(rows, "\n")
	}
	count := len(careers)
	noun := "objects"
	if count == 1 {
		noun = "object"
	}
	return fmt.Sprintf(`Authoritative career sequence from the profile (preserve count, order, company, and dates):
<<<
%s
>>>
- Return exactly %d experience %s, one per role above, in that order.
- If an earlier instruction, bullet quota, or schema maxItems asks for a different number of roles, ignore that count.
- Give every role at least one substantive bullet. If a role's profile description is blank, or the draft omitted it, still include it with one or two conservative bullets grounded in that role's title and dates.`, lines, count, noun)
}

// stackedTitle is a title that stuffs keywords: slashes, pipes, a comma list, or very long.
func stackedTitle(title string) bool {
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 80 || strings.ContainsAny(title, "|/") || strings.Count(title, ",") >= 2 {
		return true
	}
	return false
}

// acceptableDynamicTitle is a concise, conventional title a dynamic-title run may use.
func acceptableDynamicTitle(title string) bool {
	if stackedTitle(title) {
		return false
	}
	words := strings.FieldsFunc(strings.ToLower(title), func(r rune) bool { return !unicode.IsLetter(r) })
	ands := 0
	for _, word := range words {
		if word == "and" {
			ands++
		}
	}
	return ands < 2
}

// reconcileExperience pairs each profile role with the model's row for it and rebuilds the section from
// the profile: count, order, company, and dates always come from the profile, and the title does too
// unless dynamic titles are on and the model's is acceptable. Only the bullets are the model's.
// A profile with no roles has nothing to reconcile against, so the model's section stands.
func reconcileExperience(section any, careers []CareerEntry, dynamic bool) any {
	if len(careers) == 0 {
		return section
	}
	record := asRecord(section)
	list := asList(record["experiences"])
	if list == nil {
		list = asList(record["experience"])
	}
	rows := make([]map[string]any, len(list))
	for i, item := range list {
		rows[i] = asRecord(item)
	}
	matched := matchExperienceRows(careers, rows)
	experiences := make([]any, 0, len(careers))
	for i, career := range careers {
		model := matched[i]
		title := career.Title
		if dynamic {
			if suggested := asString(model["title"]); acceptableDynamicTitle(suggested) {
				title = suggested
			}
		}
		bullets := []any{}
		for _, bullet := range asList(model["bullets"]) {
			if text := asString(bullet); text != "" {
				bullets = append(bullets, text)
			}
		}
		row := map[string]any{
			"company": firstNonEmpty(career.Company, asString(model["company"])),
			"title":   title,
			"period":  firstNonEmpty(career.Period, asString(model["period"])),
			"bullets": bullets,
		}
		if location := asString(model["location"]); location != "" {
			row["location"] = location
		}
		experiences = append(experiences, row)
	}
	return map[string]any{"experiences": experiences}
}
