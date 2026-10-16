package applicant

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const applicantBody = `{"success":true,"profile":{"fullName":"Ada Lovelace","email":"ada@example.com","phone":"555 0100",
"openrouterApiKey":"sk-or-THEIRS","defaultAccountPassword":"Hunter2!pass","extensionPassword":"nope","resumeFolderPath":"/x",
"timeline":[{"title":"Engineer","org":"Acme","summary":""}]},
"files":[
 {"id":"b2","kind":"resume","title":"Go","fileName":"go.docx","format":"docx","mimeType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":30,"isPrimary":false},
 {"id":"a1","kind":"resume","title":"Go","fileName":"go.pdf","format":"pdf","mimeType":"application/pdf","size":20,"isPrimary":true},
 {"id":"c3","kind":"cover_letter","title":"Cover Letter","fileName":"letter-v2.pdf","format":"pdf","mimeType":"application/pdf","size":10},
 {"id":"","kind":"resume","title":"Broken","fileName":""}
]}`

func fakeBackend(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
		if r.Header.Get("Authorization") != "Bearer good-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/acorn/agent/applicant":
			_, _ = w.Write([]byte(applicantBody))
		case r.URL.Path == "/acorn/agent/resumes/a1":
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("X-File-Name", "go.pdf")
			_, _ = w.Write([]byte("%PDF-1.4 go"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server, &seen
}

func TestTheBackendSourceReadsTheProfileAndFilesWithThePersonsToken(t *testing.T) {
	server, seen := fakeBackend(t)
	snapshot, err := NewBackend(server.URL+"/").SnapshotFor(context.Background(), Auth{Token: "good-token"})
	if err != nil {
		t.Fatal(err)
	}
	if len(*seen) != 1 || (*seen)[0] != "GET /acorn/agent/applicant Bearer good-token" {
		t.Fatalf("requests = %v", *seen)
	}
	for _, want := range []string{`"fullName": "Ada Lovelace"`, `"phone": "555 0100"`, `"org": "Acme"`} {
		if !strings.Contains(snapshot.Profile, want) {
			t.Fatalf("profile lacks %q:\n%s", want, snapshot.Profile)
		}
	}
	// What the model must not read is gone, the password is a token, and the key is kept apart.
	for _, secret := range []string{"sk-or-THEIRS", "Hunter2!pass", "nope", "resumeFolderPath"} {
		if strings.Contains(snapshot.Profile, secret) {
			t.Fatalf("the model would read %q:\n%s", secret, snapshot.Profile)
		}
	}
	if snapshot.APIKey != "sk-or-THEIRS" || snapshot.Secrets[AccountPasswordToken] != "Hunter2!pass" {
		t.Fatalf("key %q secrets %v", snapshot.APIKey, snapshot.Secrets)
	}
	// A file with no id or name is skipped; the rest are stacks by title, or a named document.
	want := []Resume{
		{ID: "a1", FileName: "go.pdf", ContentType: "application/pdf", Size: 20, Stack: "Go", Format: "pdf", Primary: true},
		{ID: "b2", FileName: "go.docx", ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Size: 30, Stack: "Go", Format: "docx"},
		{ID: "c3", FileName: "letter-v2.pdf", ContentType: "application/pdf", Size: 10, Format: "pdf", Name: "Cover Letter"},
	}
	if len(snapshot.Resumes) != len(want) {
		t.Fatalf("resumes = %+v", snapshot.Resumes)
	}
	for i := range want {
		if snapshot.Resumes[i] != want[i] {
			t.Fatalf("resume %d = %+v, want %+v", i, snapshot.Resumes[i], want[i])
		}
	}
}

func TestWithoutASessionTheBackendIsNotAsked(t *testing.T) {
	server, seen := fakeBackend(t)
	if _, err := NewBackend(server.URL).SnapshotFor(context.Background(), Auth{}); !errors.Is(err, ErrSignedOut) {
		t.Fatalf("err = %v", err)
	}
	if len(*seen) != 0 {
		t.Fatalf("the backend was called without a session: %v", *seen)
	}
}

func TestABackendThatRefusesTheSessionMeansSignedOut(t *testing.T) {
	server, _ := fakeBackend(t)
	_, err := NewBackend(server.URL).SnapshotFor(context.Background(), Auth{Token: "expired"})
	if !errors.Is(err, ErrSignedOut) {
		t.Fatalf("err = %v", err)
	}
}

func TestAProfileThatWasNeverSavedIsNotAFormToApplyWith(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"profile":null,"files":[]}`))
	}))
	defer server.Close()
	_, err := NewBackend(server.URL).SnapshotFor(context.Background(), Auth{Token: "t"})
	if !errors.Is(err, ErrNoProfile) || !strings.Contains(err.Error(), "website") {
		t.Fatalf("err = %v", err)
	}
}

func TestABackendThatIsDownIsSaidPlainly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }))
	server.Close() // nothing is listening
	if _, err := NewBackend(server.URL).SnapshotFor(context.Background(), Auth{Token: "t"}); !errors.Is(err, ErrBackend) {
		t.Fatalf("unreachable: %v", err)
	}
	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }))
	defer failing.Close()
	if _, err := NewBackend(failing.URL).SnapshotFor(context.Background(), Auth{Token: "t"}); !errors.Is(err, ErrBackend) {
		t.Fatalf("500: %v", err)
	}
}

func TestTheBackendSourceFetchesAFileWithItsNameAndType(t *testing.T) {
	server, seen := fakeBackend(t)
	resume, data, err := NewBackend(server.URL).ResumeFor(context.Background(), Auth{Token: "good-token"}, "a1")
	if err != nil || string(data) != "%PDF-1.4 go" {
		t.Fatalf("data = %q err = %v", data, err)
	}
	if resume.FileName != "go.pdf" || resume.ContentType != "application/pdf" || resume.Format != "pdf" || resume.Size != int64(len(data)) {
		t.Fatalf("resume = %+v", resume)
	}
	if (*seen)[0] != "GET /acorn/agent/resumes/a1 Bearer good-token" {
		t.Fatalf("requests = %v", *seen)
	}
	if _, _, err := NewBackend(server.URL).ResumeFor(context.Background(), Auth{Token: "good-token"}, "missing"); !errors.Is(err, ErrNoResume) {
		t.Fatalf("a file that is not there: %v", err)
	}
	if _, _, err := NewBackend(server.URL).ResumeFor(context.Background(), Auth{Token: "bad"}, "a1"); !errors.Is(err, ErrSignedOut) {
		t.Fatalf("a refused session: %v", err)
	}
}

func TestAnIdIsEscapedSoItCannotReachAnotherRoute(t *testing.T) {
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.EscapedPath()
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()
	_, _, _ = NewBackend(server.URL).ResumeFor(context.Background(), Auth{Token: "t"}, "../profile")
	if strings.Contains(path, "/../") || !strings.HasPrefix(path, "/acorn/agent/resumes/") {
		t.Fatalf("path = %q", path)
	}
}
