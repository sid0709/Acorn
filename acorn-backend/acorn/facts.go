package acorn

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Fact is one profile fact a free-text field can be filled from. The decision
// model picks a fact by its key and description only — it never sees the
// applicant's values; Value reads them from the profile.
type Fact struct {
	Key         string
	Description string
	Value       func(p applicantFacts) string
}

const (
	// FactWrite means the field needs a written answer from the text model.
	FactWrite = "write"
	// FactSkip means the profile has nothing for the field: leave it blank.
	FactSkip = "skip"
	// FactOtherPerson is a field about someone else (a reference, a contact).
	FactOtherPerson = "other_person"
	// FactUnknownDetail is a detail of a school or job the profile does not hold.
	FactUnknownDetail = "unknown_detail"
	// FactPersonOnly is a value only the applicant can give in the moment: never
	// filled, never written, whatever the field's required mark says.
	FactPersonOnly = "person_only"
)

var digitsOnly = regexp.MustCompile(`\D+`)

// facts are the heuristic callers, in the order the decision model reads them.
var facts = []Fact{
	{"first_name", "The applicant's first (given) name.", func(p applicantFacts) string { return p.str("firstName") }},
	{"last_name", "The applicant's last (family) name.", func(p applicantFacts) string { return p.str("lastName") }},
	{"full_name", "The applicant's full legal name (first and last).", func(p applicantFacts) string { return p.str("fullName") }},
	{"preferred_name", "The single given name the applicant prefers to be called. A field asking for a preferred full name wants full_name.", func(p applicantFacts) string { return p.str("firstName") }},
	{"email", "The applicant's email address.", func(p applicantFacts) string { return p.str("email") }},
	{"phone", "The applicant's phone number.", func(p applicantFacts) string { return p.str("phone") }},
	{"linkedin", "LinkedIn profile URL.", func(p applicantFacts) string { return p.str("linkedin") }},
	{"github", "GitHub profile URL.", func(p applicantFacts) string { return p.str("github") }},
	{"website", "Personal website or portfolio URL — not an account on a social network or other platform.", func(p applicantFacts) string {
		return firstFact(p.str("portfolioUrl"), p.str("github"), p.str("linkedin"))
	}},
	{"street_address", "Street address line (house number and street).", func(p applicantFacts) string { return p.str("address") }},
	{"city", "City the applicant lives in.", func(p applicantFacts) string { return p.str("city") }},
	{"state", "State or province the applicant lives in.", func(p applicantFacts) string { return p.str("state") }},
	{"zip_code", "ZIP or postal code.", func(p applicantFacts) string { return p.str("zipCode") }},
	{"country", "Country the applicant lives in.", func(p applicantFacts) string { return p.str("country") }},
	{"location", "Current location as one line (city, state).", func(p applicantFacts) string {
		if city, state := p.str("city"), p.str("state"); city != "" && state != "" {
			return city + ", " + state
		}
		return p.str("location")
	}},
	{"current_company", "Current or most recent employer's name (company, employer).", func(p applicantFacts) string { return p.career(0, "company") }},
	{"current_title", "Current or most recent job title (position title, role).", func(p applicantFacts) string { return p.career(0, "role") }},
	{"school", "Most recent school, college, or university name.", func(p applicantFacts) string { return p.education(0, "school") }},
	{"degree", "Highest degree earned.", func(p applicantFacts) string { return p.education(0, "degree") }},
	{"field_of_study", "Field of study or major.", func(p applicantFacts) string {
		return firstFact(p.education(0, "field"), subjectOf(p.education(0, "degree")))
	}},
	{"graduation_year", "Year of graduation from the most recent school.", func(p applicantFacts) string {
		return yearOf(p.education(0, "end"))
	}},
	{"school_start_date", "Start date at the most recent school (education section).", func(p applicantFacts) string { return p.education(0, "start") }},
	{"school_end_date", "End or graduation date at the most recent school (education section).", func(p applicantFacts) string { return p.education(0, "end") }},
	{"job_start_date", "Start date at the current or most recent job (employment section).", func(p applicantFacts) string { return p.career(0, "start") }},
	{"job_end_date", "End date at the most recent job; blank when it is the current job (employment section).", func(p applicantFacts) string { return p.career(0, "end") }},
	{"years_of_experience", "Total years of professional experience, as a number.", func(p applicantFacts) string {
		return p.yearsOfExperience()
	}},
	{"desired_salary", "Desired or expected salary, as a number.", func(p applicantFacts) string {
		return digitsOnly.ReplaceAllString(p.str("desiredSalary"), "")
	}},
	{"notice_period", "When the applicant can start, or their notice period.", func(p applicantFacts) string { return p.str("noticePeriod") }},
	{"pronouns", "The applicant's pronouns.", func(p applicantFacts) string { return p.str("pronouns") }},
	{"headline", "A short professional headline.", func(p applicantFacts) string { return p.str("headline") }},
}

// factKinds is the decision model's menu for a free-text field: every fact, plus
// write (the text model answers) and skip (leave blank).
func factKinds() map[string]string {
	kinds := make(map[string]string, len(facts)+2)
	for _, fact := range facts {
		kinds[fact.Key] = fact.Description
	}
	kinds[FactWrite] = "The field asks for a written answer the profile does not hold as one fact: a reason, a description, a cover letter, or any open question."
	kinds[FactSkip] = "Nothing in a job application profile answers it (fax, pager, middle name, address line 2, an extension, an account on a platform the profile names no URL for): leave it blank."
	kinds[FactOtherPerson] = "A field about another person, not the applicant: a reference, an emergency contact, a referrer, or a supervisor — their name, email, phone, title, or relationship."
	kinds[FactPersonOnly] = "A value only the applicant can give in the moment: a one-time code sent to them, the answer to a challenge, or a password they set for an account."
	kinds[FactUnknownDetail] = "A detail of one school or job entry the profile does not hold: that school's or job's city, department, supervisor, GPA, or minor."
	return kinds
}

// factValue is the profile's value for a fact key; "" when unknown or empty.
func factValue(p applicantFacts, key string) string {
	for _, fact := range facts {
		if fact.Key == key {
			return strings.TrimSpace(fact.Value(p))
		}
	}
	return ""
}

// applicantFacts is the applicant profile JSON (see ApplicantProfileTextWith),
// read by the heuristic callers.
type applicantFacts struct {
	settings map[string]any
}

func parseApplicantFacts(applicant string) applicantFacts {
	var doc struct {
		Settings map[string]any `json:"settings"`
	}
	_ = json.Unmarshal([]byte(applicant), &doc)
	return applicantFacts{settings: doc.Settings}
}

func (p applicantFacts) str(key string) string {
	return textOf(p.settings[key])
}

func (p applicantFacts) entries(key string) []map[string]any {
	items, _ := p.settings[key].([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if row, ok := item.(map[string]any); ok {
			out = append(out, row)
		}
	}
	return out
}

func (p applicantFacts) career(i int, field string) string {
	rows := p.entries("careers")
	if i >= len(rows) {
		return ""
	}
	return textOf(rows[i][field])
}

func (p applicantFacts) education(i int, field string) string {
	rows := p.entries("education")
	if i >= len(rows) {
		return ""
	}
	return textOf(rows[i][field])
}

// yearsOfExperience counts from the earliest career start to now.
func (p applicantFacts) yearsOfExperience() string {
	earliest := 0
	for _, row := range p.entries("careers") {
		if year, err := strconv.Atoi(yearOf(textOf(row["start"]))); err == nil && (earliest == 0 || year < earliest) {
			earliest = year
		}
	}
	if earliest == 0 {
		return ""
	}
	return strconv.Itoa(max(time.Now().Year()-earliest, 0))
}

func textOf(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "Yes"
		}
		return "No"
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func yearOf(date string) string {
	if len(date) >= 4 {
		if _, err := strconv.Atoi(date[:4]); err == nil {
			return date[:4]
		}
	}
	return ""
}

// subjectOf is the subject part of a degree ("Bachelor of Science, Computer Science"
// → "Computer Science"); "" when the degree names no subject.
func subjectOf(degree string) string {
	if _, subject, ok := strings.Cut(degree, ","); ok {
		return strings.TrimSpace(subject)
	}
	if _, subject, ok := strings.Cut(degree, " in "); ok {
		return strings.TrimSpace(subject)
	}
	return ""
}

func firstFact(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
