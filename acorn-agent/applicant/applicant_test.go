package applicant

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestSnapshotReadsProfileAndResumes(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ProfileFile), `{"name":"Ada","skills":["go"]}`)
	writeFile(t, filepath.Join(dir, ResumeDir, "top.pdf"), "pdf")
	writeFile(t, filepath.Join(dir, ResumeDir, "data", "Ada.docx"), "docx")
	writeFile(t, filepath.Join(dir, ResumeDir, "data", "notes.md"), "not a résumé")
	writeFile(t, filepath.Join(dir, ResumeDir, ".hidden.pdf"), "hidden")

	got, err := NewStore(dir).Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.Profile, `"name": "Ada"`) {
		t.Fatalf("profile is not indented as written: %q", got.Profile)
	}
	var ids []string
	for _, resume := range got.Resumes {
		ids = append(ids, resume.ID)
	}
	if strings.Join(ids, ",") != "data/Ada.docx,top.pdf" {
		t.Fatalf("resumes = %v", ids)
	}
	if got.Resumes[0].ContentType != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Fatalf("content type = %q", got.Resumes[0].ContentType)
	}
}

func TestSnapshotNeedsAProfile(t *testing.T) {
	dir := t.TempDir()
	if _, err := NewStore(dir).Snapshot(context.Background()); !errors.Is(err, ErrNoProfile) {
		t.Fatalf("missing profile: %v", err)
	}
	writeFile(t, filepath.Join(dir, ProfileFile), "   ")
	if _, err := NewStore(dir).Snapshot(context.Background()); !errors.Is(err, ErrNoProfile) {
		t.Fatalf("empty profile: %v", err)
	}
	writeFile(t, filepath.Join(dir, ProfileFile), "{not json")
	if _, err := NewStore(dir).Snapshot(context.Background()); err == nil || !strings.Contains(err.Error(), "not valid JSON") {
		t.Fatalf("bad profile: %v", err)
	}
}

func TestResumeRejectsPathsOutsideTheFolder(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ProfileFile), `{}`)
	writeFile(t, filepath.Join(dir, ResumeDir, "a.pdf"), "pdf-bytes")
	writeFile(t, filepath.Join(dir, "secret.pdf"), "secret")
	store := NewStore(dir)

	resume, data, err := store.Resume(context.Background(), "a.pdf")
	if err != nil || string(data) != "pdf-bytes" || resume.FileName != "a.pdf" {
		t.Fatalf("resume = %+v, %q, %v", resume, data, err)
	}
	for _, id := range []string{"../secret.pdf", "/etc/passwd", "missing.pdf", ""} {
		if _, _, err := store.Resume(context.Background(), id); !errors.Is(err, ErrNoResume) {
			t.Fatalf("Resume(%q) = %v, want ErrNoResume", id, err)
		}
	}
}

func TestAnExportIsUnwrappedAndItsSecretsStayOutOfWhatTheModelReads(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ProfileFile), `{
	  "_id": {"$oid": "64b"}, "accountId": "acc-1", "updatedAt": {"$date": "2026-10-15"},
	  "profile": {
	    "fullName": "Ada Lovelace", "middleName": "", "email": "ada@example.com",
	    "openrouterApiKey": "sk-or-SECRET", "extensionPassword": "ext-SECRET",
	    "defaultAccountPassword": "Hunter2!pass", "internalNote": "hide me too",
	    "timeline": [{"title": "Engineer", "org": "Analytical Engines", "summary": ""}, {}]
	  }}`)
	got, err := NewStore(dir, "internalNote", " ").Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"sk-or-SECRET", "ext-SECRET", "Hunter2", "64b", "acc-1", "hide me", "updatedAt", "middleName"} {
		if strings.Contains(got.Profile, secret) {
			t.Fatalf("%q reached the model's profile:\n%s", secret, got.Profile)
		}
	}
	for _, want := range []string{`"fullName": "Ada Lovelace"`, `"defaultAccountPassword": "{{account_password}}"`, `"org": "Analytical Engines"`} {
		if !strings.Contains(got.Profile, want) {
			t.Fatalf("profile lacks %s:\n%s", want, got.Profile)
		}
	}
	if strings.Count(got.Profile, `"title"`) != 1 {
		t.Fatalf("an empty timeline entry was kept:\n%s", got.Profile)
	}
	if got.Secrets[AccountPasswordToken] != "Hunter2!pass" || got.APIKey != "sk-or-SECRET" {
		t.Fatalf("secrets=%v key=%q", got.Secrets, got.APIKey)
	}
}

func TestAPlainProfileIsReadAsWritten(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ProfileFile), `{"name":"Ada","skills":["go","sql"],"defaultAccountPassword":""}`)
	got, err := NewStore(dir).Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.Profile, `"skills": [`) || len(got.Secrets) != 0 || got.APIKey != "" {
		t.Fatalf("snapshot = %+v", got)
	}
	if strings.Contains(got.Profile, "defaultAccountPassword") {
		t.Fatalf("an empty password shows as a field the model could fill:\n%s", got.Profile)
	}
}

func TestResumesKnowTheirStackAndFormat(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ProfileFile), `{}`)
	writeFile(t, filepath.Join(dir, ResumeDir, "C# + React", "Ada.PDF"), "x")
	writeFile(t, filepath.Join(dir, ResumeDir, "Cover Letter.docx"), "x")
	got, err := NewStore(dir).Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.Resumes[1].Stack != "" || got.Resumes[1].Format != "docx" {
		t.Fatalf("loose file = %+v", got.Resumes[1])
	}
	if got.Resumes[0].Stack != "C# + React" || got.Resumes[0].Format != "pdf" {
		t.Fatalf("stack file = %+v", got.Resumes[0])
	}
}
