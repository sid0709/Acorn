package acorn

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/candidate"
)

// fakeModel answers each call from a queue of replies, in order. Calls may come
// from parallel writers, so the queue is guarded.
type fakeModel struct {
	mu      sync.Mutex
	replies []string
	calls   []string
}

func (f *fakeModel) JSON(_ context.Context, system, user string, _ json.RawMessage) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, system[:20]+"|"+user)
	if len(f.replies) == 0 {
		return nil, context.DeadlineExceeded
	}
	reply := f.replies[0]
	f.replies = f.replies[1:]
	return []byte(reply), nil
}
func (f *fakeModel) Model() string { return "fake" }
func (f *fakeModel) Ready() bool   { return true }

func TestAnswer(t *testing.T) {
	svc := New(&fakeModel{replies: []string{`{"answers":[{"element_index":1,"value":" Hello. "}]}`}})
	qa, err := svc.Answer(context.Background(), "P", "Why?", nil)
	if err != nil || qa.Answer != "Hello." {
		t.Fatalf("qa = %+v err %v", qa, err)
	}
	if _, err := svc.Answer(context.Background(), "P", "  ", nil); err == nil {
		t.Error("an empty question should fail")
	}
}

func TestApplicantProfileText(t *testing.T) {
	text := ApplicantProfileText("u1", candidate.Profile{
		Name: "Jordan Q Lee", Email: "j@example.com", Authorization: "Authorized, no sponsorship",
		HomeAddress: candidate.HomeAddress{City: "Austin", Region: "TX"}, SalaryFloor: 120000, Currency: "USD",
		Experience: []candidate.ExperienceItem{{Role: "Engineer", Company: "Acme"}},
	})
	var parsed struct {
		Settings map[string]any `json:"settings"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		t.Fatalf("profile text is not JSON: %v", err)
	}
	s := parsed.Settings
	if s["firstName"] != "Jordan" || s["lastName"] != "Lee" || s["city"] != "Austin" || s["desiredSalary"] != "120000 USD" {
		t.Errorf("settings = %v", s)
	}
	if s["phone"] != nil || s["linkedin"] != nil {
		t.Errorf("empty fields must be null: %v", s)
	}
	if strings.Contains(text, `<`) {
		t.Error("HTML must not be escaped")
	}
}

func TestApplicantProfileTextCarriesProfileDetails(t *testing.T) {
	text := ApplicantProfileText("u1", candidate.Profile{
		Name: "Stanley Wang", Authorization: "us-sponsor",
		Personal:    candidate.Personal{FirstName: "Stan", Age: 35, Gender: "male", Citizenship: "us-citizen"},
		Links:       candidate.Links{LinkedIn: "https://www.linkedin.com/in/stan"},
		Disclosures: candidate.Disclosures{Sponsorship: "not-required", Race: "asian", Veteran: "decline"},
		Experience: []candidate.ExperienceItem{{Role: "Senior Software Engineer", Company: "Uber",
			DateRange: candidate.DateRange{StartMonth: 1, StartYear: 2022, Current: true}}},
		Education: []candidate.EducationItem{{School: "UC Berkeley", Degree: "BS",
			DateRange: candidate.DateRange{StartYear: 2009, EndMonth: 5, EndYear: 2013}}},
	})
	var parsed struct {
		Settings struct {
			FirstName         string           `json:"firstName"`
			LastName          string           `json:"lastName"`
			Age               int              `json:"age"`
			ImmigrationStatus string           `json:"immigrationStatus"`
			Sponsorship       string           `json:"sponsorship"`
			Race              string           `json:"race"`
			VeteranStatus     string           `json:"veteranStatus"`
			LinkedIn          string           `json:"linkedin"`
			Careers           []map[string]any `json:"careers"`
			Education         []map[string]any `json:"education"`
		} `json:"settings"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		t.Fatalf("profile text is not JSON: %v", err)
	}
	s := parsed.Settings
	if s.FirstName != "Stan" || s.LastName != "Wang" || s.Age != 35 {
		t.Errorf("name/age = %q %q %d", s.FirstName, s.LastName, s.Age)
	}
	if s.ImmigrationStatus != "us-citizen" || s.Sponsorship != "not-required" {
		t.Errorf("profile answers must win over the legacy authorization: %q / %q", s.ImmigrationStatus, s.Sponsorship)
	}
	if s.Race != "asian" || s.VeteranStatus != "decline" || s.LinkedIn == "" {
		t.Errorf("disclosures/links = %+v", s)
	}
	if len(s.Careers) != 1 || s.Careers[0]["start"] != "2022-01" || s.Careers[0]["end"] != nil || s.Careers[0]["current"] != true {
		t.Errorf("careers = %v", s.Careers)
	}
	if len(s.Education) != 1 || s.Education[0]["start"] != "2009" || s.Education[0]["end"] != "2013-05" {
		t.Errorf("education = %v", s.Education)
	}
}
