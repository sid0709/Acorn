package acorn

import "strings"

// Credentials are what an account step needs that no model ever reads: the
// profile's default account password, and a verification code found in the
// applicant's mail. Only the plan carries them, straight to the page.
type Credentials struct {
	Password         string
	VerificationCode string
}

const (
	// FactAccountPassword is the password for the applicant's account on the job site.
	FactAccountPassword = "account_password"
	// FactVerificationCode is a one-time code the site emailed the applicant.
	FactVerificationCode = "verification_code"
)

// secretFacts are never written by a model: an empty one leaves the field blank.
var secretFacts = map[string]bool{FactAccountPassword: true, FactVerificationCode: true}

const (
	// inputTypePassword is the input type a browser masks. Only the account password fills it.
	inputTypePassword = "password"
	// rolePassword is the plan role of a fill into a password box, so the
	// extension can keep its value out of everything it shows or logs.
	rolePassword = "password"
	// redactedValue stands in for a secret in a plan copy written to a debug trace.
	redactedValue = "(hidden)"
)

// WithCredentials returns a copy that fills account passwords and verification
// codes from these values.
func (s *Service) WithCredentials(credentials Credentials) *Service {
	next := *s
	next.credentials = Credentials{
		Password:         credentials.Password,
		VerificationCode: strings.TrimSpace(credentials.VerificationCode),
	}
	return &next
}

// facts parses the applicant profile and adds the credentials the facts read.
func (s *Service) facts(applicant string) applicantFacts {
	profile := parseApplicantFacts(applicant)
	profile.credentials = s.credentials
	return profile
}

// isPasswordFill is a fill into a password box: by its role, or by its element
// when the page reported that element as a password box.
func isPasswordFill(row map[string]any, passwords map[int]bool) bool {
	if str(row, "action") != "fill" {
		return false
	}
	if roleToken(str(row, "expected_role")) == rolePassword {
		return true
	}
	index, ok := elementIndex(row)
	return ok && passwords[index]
}

// fillPasswords puts the account password into every password fill a text-model
// plan made, and drops those fills when the profile has none: the text model
// never knows the password, so whatever it planned there is not it.
func (s *Service) fillPasswords(plan Plan, passwords map[int]bool) Plan {
	items, _ := plan["actions"].([]any)
	kept := make([]any, 0, len(items))
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok || !isPasswordFill(row, passwords) {
			kept = append(kept, item)
			continue
		}
		if s.credentials.Password == "" {
			continue
		}
		row["value"] = s.credentials.Password
		row["expected_role"] = rolePassword
		kept = append(kept, row)
	}
	plan["actions"] = kept
	return plan
}

// RedactedResult is a copy of result with every password fill's value hidden,
// for a debug trace.
func RedactedResult(result AnalyzeResult) AnalyzeResult {
	items, _ := result.Plan["actions"].([]any)
	actions := make([]any, len(items))
	for i, item := range items {
		row, ok := item.(map[string]any)
		if !ok || !isPasswordFill(row, nil) {
			actions[i] = item
			continue
		}
		copied := make(map[string]any, len(row))
		for key, value := range row {
			copied[key] = value
		}
		copied["value"] = redactedValue
		actions[i] = copied
	}
	plan := make(Plan, len(result.Plan))
	for key, value := range result.Plan {
		plan[key] = value
	}
	if result.Plan != nil {
		plan["actions"] = actions
	}
	result.Plan = plan
	return result
}
