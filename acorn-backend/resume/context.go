package resume

import (
	"encoding/json"
	"fmt"
	"strings"
)

// contextBlock is the candidate's profile as authoritative fact. It sits in the system message, ahead
// of anything that changes between steps, so providers can cache it.
func contextBlock(identity Identity) string {
	raw, _ := json.MarshalIndent(identity, "", "  ")
	return "CANDIDATE PROFILE — these are authoritative facts. Do not invent employers, dates, schools, or credentials.\n\n" + string(raw)
}

// blankCareerNotice guides the model when profile roles have no description, so a blank role still gets
// credible, conservative bullets rather than an empty heading or invented facts.
func blankCareerNotice(identity Identity) string {
	blank := 0
	for _, career := range identity.Careers {
		if strings.TrimSpace(career.Description) == "" {
			blank++
		}
	}
	if blank == 0 {
		return ""
	}
	subject := "descriptions are"
	if blank == 1 {
		subject = "description is"
	}
	return fmt.Sprintf(`OPTIONAL CAREER DETAILS — %d career %s blank.
Career descriptions are optional and blank descriptions must not produce empty Experience roles. Infer credible, non-quantified bullets from role titles, chronology, and the job description only where needed to keep every role substantive.
Keep blank roles to one or two conservative bullets and do not invent employer-specific facts, metrics, achievements, project names, internal systems, team size, or ownership.`, blank, subject)
}
