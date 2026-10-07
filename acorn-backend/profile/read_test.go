package profile

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

type fakeModel struct {
	answer string
	err    error
}

func (m fakeModel) JSON(context.Context, string, string, json.RawMessage) ([]byte, error) {
	return []byte(m.answer), m.err
}

func (fakeModel) Ready() bool { return true }

const modelAnswer = `{
  "fullName": "Jordan Avery Lee", "firstName": "Jordan", "middleName": "Avery", "lastName": "Lee",
  "headline": "Senior Full-Stack Engineer", "email": "jordan.lee@example.com", "phone": "(555) 999-0000",
  "street": "", "city": "Fresno", "state": "California", "zip": "", "country": "USA",
  "linkedin": "linkedin.com/in/jordan-lee-01", "github": "", "portfolio": "",
  "experience": [{"title": "Senior Full-Stack Engineer", "company": "Northwind", "location": "San Francisco, CA",
    "startMonth": "1", "startYear": "2022", "endMonth": "", "endYear": "", "current": true,
    "highlights": ["• Optimized queries.", "Shipped notifications."]}],
  "education": [{"degree": "Bachelor of Science", "field": "Computer Science", "school": "State University",
    "location": "Berkeley, CA", "startMonth": "8", "startYear": "2009", "endMonth": "13", "endYear": "2013"}]
}`

func TestFillReadsWithModel(t *testing.T) {
	store := &Store{rows: map[string]Document{}, model: fakeModel{answer: modelAnswer}}
	filled, err := store.FillText(context.Background(), "acct", "Account", "account@example.com", titleThenCompany, nil)
	if err != nil {
		t.Fatal(err)
	}
	doc := filled.Profile
	if filled.Reader != ReaderAI {
		t.Fatalf("reader = %s", filled.Reader)
	}
	if doc.State != "CA" || doc.Country != unitedStates || doc.Headline != "Senior Full-Stack Engineer" {
		t.Fatalf("place = %s %s %q", doc.State, doc.Country, doc.Headline)
	}
	if doc.Phone != "(555) 010-2233" {
		t.Fatalf("a phone the résumé does not contain must not replace the parsed one: %s", doc.Phone)
	}
	if doc.Linkedin != linkedinBase+"jordan-lee-01" {
		t.Fatalf("linkedin = %s", doc.Linkedin)
	}
	if len(doc.Timeline) != 2 || doc.Timeline[0].Summary != "Optimized queries.\nShipped notifications." {
		t.Fatalf("timeline = %+v", doc.Timeline)
	}
	school := doc.Timeline[1]
	if school.Title != "Bachelor of Science, Computer Science" || school.EndMonth != "" || school.EndYear != "2013" {
		t.Fatalf("school = %+v", school)
	}
}

func TestFillFallsBackToLayout(t *testing.T) {
	store := &Store{rows: map[string]Document{}, model: fakeModel{err: errors.New("model down")}}
	filled, err := store.FillText(context.Background(), "acct", "Account", "account@example.com", titleThenCompany, nil)
	if err != nil {
		t.Fatal(err)
	}
	if filled.Reader != ReaderLayout || filled.Profile.City != "Fresno" || len(filled.Profile.Timeline) != 3 {
		t.Fatalf("filled = %s %+v", filled.Reader, filled.Profile)
	}
}

func TestFillWithoutKeyStaysOnLayout(t *testing.T) {
	store := &Store{rows: map[string]Document{}}
	filled, err := store.FillText(context.Background(), "acct", "Account", "account@example.com", titleThenCompany, nil)
	if err != nil {
		t.Fatal(err)
	}
	if filled.Reader != ReaderLayout || filled.Profile.OpenrouterApiKey != "" {
		t.Fatalf("filled = %s key=%q", filled.Reader, filled.Profile.OpenrouterApiKey)
	}
}

func TestDefaultAnswersStayEditable(t *testing.T) {
	doc := normalize(Document{})
	if doc.Citizenship != "U.S. Citizen" || doc.Over18 != "Yes" || doc.VeteranStatus != "I am not a protected veteran" || doc.WillingToRelocate != "Yes" {
		t.Fatalf("defaults = %+v", doc)
	}
	doc.Citizenship, doc.WorkModePreference, doc.RaceEthnicity = "Permanent resident", "Hybrid", "Decline to answer"
	again := normalize(doc)
	if again.Citizenship != "Permanent resident" || again.WorkModePreference != "Hybrid" || again.RaceEthnicity != "Decline to answer" {
		t.Fatalf("a chosen answer was overwritten: %+v", again)
	}
}
