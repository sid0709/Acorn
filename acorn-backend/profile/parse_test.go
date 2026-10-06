package profile

import (
	"strings"
	"testing"
)

const sampleResume = `Jordan Avery Lee
San Francisco, CA
United States
jordan@example.com
(415) 555-0148
linkedin.com/in/jordan
https://github.com/jordan
https://jordan.dev

Experience
Northwind
Senior Software Engineer
Jan 2022 - Present
Built hiring tools.

Lumen
Software Engineer
Mar 2018 - Dec 2021

Education
State University
B.S. Computer Science
Sep 2011 - May 2015
`

func TestMergeResumeFillsContactAndTimeline(t *testing.T) {
	next, err := MergeResume(Blank("Account Name", "account@example.com"), sampleResume)
	if err != nil {
		t.Fatal(err)
	}
	if next.FullName != "Jordan Avery Lee" || next.FirstName != "Jordan" || next.MiddleName != "Avery" || next.LastName != "Lee" {
		t.Fatalf("name = %+v", next)
	}
	if next.Email != "jordan@example.com" || next.Phone != "(415) 555-0148" {
		t.Fatalf("contact = %s %s", next.Email, next.Phone)
	}
	if next.Linkedin != "https://www.linkedin.com/in/jordan" || next.Github == "" || next.Portfolio != "https://jordan.dev" {
		t.Fatalf("links = %s %s %s", next.Linkedin, next.Github, next.Portfolio)
	}
	if next.City != "San Francisco" || next.State != "CA" || next.Country != "United States" {
		t.Fatalf("place = %s %s %s", next.City, next.State, next.Country)
	}
	if next.Gender != "Male" || next.Orientation != "Heterosexual" {
		t.Fatalf("defaults = %s %s", next.Gender, next.Orientation)
	}
	if len(next.Timeline) < 3 {
		t.Fatalf("timeline = %+v", next.Timeline)
	}
	role := next.Timeline[0]
	if role.Kind != "role" || role.Title != "Senior Software Engineer" || role.Org != "Northwind" || !role.Current || role.StartYear != "2022" {
		t.Fatalf("role = %+v", role)
	}
	school := next.Timeline[len(next.Timeline)-1]
	if school.Kind != "education" || school.Org != "State University" || school.EndYear != "2015" {
		t.Fatalf("school = %+v", school)
	}
	if next.VisaSponsorship != defaultVisaSponsorship || next.OpenaiApiKey != "" {
		t.Fatal("résumé text must not invent disclosures or secrets")
	}
}

func TestPlaceReadsStateNameAndZip(t *testing.T) {
	next, err := MergeResume(Blank("Ada Lovelace", "ada@example.com"), "Ada Lovelace\nada@example.com\nAustin, Texas 78701\nhttps://linkedin.com/in/ada-lovelace\nExperience\nAnalytical Engines\nMathematician\nJan 2018 - Present\nWrote notes.\n")
	if err != nil {
		t.Fatal(err)
	}
	if next.City != "Austin" || next.State != "TX" || next.Country != "United States" || next.Zip != "78701" {
		t.Fatalf("place = %s %s %s %s", next.City, next.State, next.Country, next.Zip)
	}
	if next.Linkedin != "https://www.linkedin.com/in/ada-lovelace" {
		t.Fatalf("linkedin = %s", next.Linkedin)
	}
}

func TestMergeResumeKeepsShortText(t *testing.T) {
	if _, err := MergeResume(Blank("A", "a@b.co"), "too short"); err != ErrUnreadable {
		t.Fatalf("err = %v", err)
	}
}

func TestCandidateOmitsSecrets(t *testing.T) {
	doc := Blank("Jordan Lee", "j@example.com")
	doc.Phone = "(415) 555-0148"
	doc.OpenaiApiKey = "sk-secret"
	doc.WorkAuthorized = "Yes"
	doc.DesiredSalary = "150000"
	doc.Timeline = []Entry{{ID: "1", Kind: "role", Title: "Engineer", Org: "Northwind", StartMonth: "1", StartYear: "2022", Current: true}}
	text := doc.Candidate("Jordan Lee", "j@example.com")
	if text.Phone != "(415) 555-0148" || text.SalaryFloor != 150000 || text.Authorization != "Yes" {
		t.Fatalf("candidate = %+v", text)
	}
	if strings.Contains(text.Name, "sk-secret") {
		t.Fatal("secret leaked into the candidate name")
	}
	extra := doc.PlannerExtra()
	if extra["workAuthorized"] != "Yes" || extra["middleName"] != "" {
		t.Fatalf("extra = %v", extra)
	}
	for key := range extra {
		if strings.Contains(strings.ToLower(key), "password") || strings.Contains(strings.ToLower(key), "key") {
			t.Fatalf("secret key in planner extra: %s", key)
		}
	}
}
