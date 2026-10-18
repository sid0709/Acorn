package acornapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-backend/resume"
)

type agentApplicantBody struct {
	Profile *map[string]any `json:"profile"`
	Files   []struct {
		ID       string `json:"id"`
		Kind     string `json:"kind"`
		Title    string `json:"title"`
		FileName string `json:"fileName"`
		Format   string `json:"format"`
		MimeType string `json:"mimeType"`
		Primary  bool   `json:"isPrimary"`
		Text     string `json:"extractedText"`
	} `json:"files"`
}

func uploadFile(t *testing.T, handler http.Handler, body string) string {
	t.Helper()
	rec := call(handler, "POST", "/acorn/resume/library", body, bearer("hunter"), "")
	var got struct {
		Resume struct {
			ID string `json:"id"`
		} `json:"resume"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusCreated {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	return got.Resume.ID
}

func TestTheAgentNeedsASignedInPerson(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	for _, path := range []string{"/acorn/agent/applicant", "/acorn/agent/resumes/x"} {
		if rec := call(handler, "GET", path, "", nil, ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without a session = %d", path, rec.Code)
		}
	}
}

func TestTheAgentIsToldWhenThereIsNoStoredProfile(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	rec := call(handler, "GET", "/acorn/agent/applicant", "", bearer("hunter"), "")
	var got agentApplicantBody
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK || got.Profile != nil {
		t.Fatalf("applicant = %d %s", rec.Code, rec.Body)
	}
}

func TestTheAgentReadsTheProfileAndTheNamedFilesWithoutTheirText(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	if rec := call(handler, "PUT", "/acorn/profile", `{"fullName":"Jordan Lee","email":"j@example.com","phone":"555 0100"}`, bearer("hunter"), ""); rec.Code != http.StatusOK {
		t.Fatalf("save profile = %d %s", rec.Code, rec.Body)
	}
	pdf := uploadFile(t, handler, `{"fileName":"go.pdf","title":"Go","contentBase64":"R28gSFRUUCBzZXJ2aWNlcw==","extractedText":"Go engineer with many years of Go services work"}`)
	docx := uploadFile(t, handler, `{"fileName":"go.docx","title":"Go","contentBase64":"R28gZG9j"}`)
	letter := uploadFile(t, handler, `{"fileName":"letter.txt","title":"Letter","kind":"`+resume.KindCoverLetter+`","contentBase64":"RGVhciB0ZWFt"}`)

	rec := call(handler, "GET", "/acorn/agent/applicant", "", bearer("hunter"), "")
	var got agentApplicantBody
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("applicant = %d %s", rec.Code, rec.Body)
	}
	if got.Profile == nil || (*got.Profile)["fullName"] != "Jordan Lee" || (*got.Profile)["phone"] != "555 0100" {
		t.Fatalf("profile = %v", got.Profile)
	}
	byID := map[string]int{}
	for i, file := range got.Files {
		byID[file.ID] = i
		if file.Text != "" {
			t.Fatalf("the agent is sent a file's text: %+v", file)
		}
	}
	if len(got.Files) != 3 {
		t.Fatalf("files = %+v", got.Files)
	}
	first := got.Files[byID[pdf]]
	if first.Title != "Go" || first.Format != "pdf" || first.Kind != resume.KindResume || first.FileName != "go.pdf" {
		t.Fatalf("pdf row = %+v", first)
	}
	if got.Files[byID[docx]].Format != "docx" || got.Files[byID[letter]].Kind != resume.KindCoverLetter {
		t.Fatalf("rows = %+v", got.Files)
	}
}

func TestTheAgentFetchesEachVersionOfAStackByItsOwnId(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	pdf := uploadFile(t, handler, `{"fileName":"go.pdf","title":"Go","contentBase64":"R28gSFRUUCBzZXJ2aWNlcw=="}`)
	docx := uploadFile(t, handler, `{"fileName":"go.docx","title":"Go","contentBase64":"R28gZG9j"}`)
	for id, want := range map[string]string{pdf: "Go HTTP services", docx: "Go doc"} {
		rec := call(handler, "GET", "/acorn/agent/resumes/"+id, "", bearer("hunter"), "")
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Fatalf("file %s = %d %q, want %q", id, rec.Code, rec.Body.String(), want)
		}
		if rec.Header().Get("X-File-Name") == "" || strings.Contains(rec.Header().Get("Content-Type"), "json") {
			t.Fatalf("headers = %v", rec.Header())
		}
	}
	if rec := call(handler, "GET", "/acorn/agent/resumes/nope", "", bearer("hunter"), ""); rec.Code != http.StatusNotFound {
		t.Fatalf("a file that is not there = %d", rec.Code)
	}
}
