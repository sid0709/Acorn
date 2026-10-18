package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
)

// fakeSource is an applicant read from somewhere else than files: it records who asked.
type fakeSource struct {
	snapshot applicant.Snapshot
	err      error
	asked    []applicant.Auth
	fetched  []string
}

func (f *fakeSource) Kind() string { return "fake" }

func (f *fakeSource) SnapshotFor(_ context.Context, auth applicant.Auth) (applicant.Snapshot, error) {
	f.asked = append(f.asked, auth)
	return f.snapshot, f.err
}

func (f *fakeSource) ResumeFor(_ context.Context, auth applicant.Auth, id string) (applicant.Resume, []byte, error) {
	f.asked = append(f.asked, auth)
	f.fetched = append(f.fetched, id)
	return applicant.Resume{ID: id, FileName: "x.pdf"}, []byte("bytes"), nil
}

func sourceAgent(source applicant.Source) *Agent {
	return New(DefaultConfig(), source,
		func(string) llm.Model { return &scriptedModel{} }, func(string) Decider { return &fixedDecider{} }, nil)
}

func TestARunReadsTheApplicantWithTheSessionItWasStartedWith(t *testing.T) {
	source := &fakeSource{snapshot: applicant.Snapshot{
		Profile: `{"fullName":"Ada"}`, Resumes: []applicant.Resume{{ID: "r1", Stack: "Go", FileName: "go.pdf", Format: "pdf"}},
	}}
	a := sourceAgent(source)
	started, err := a.Start(context.Background(), "key", applicant.Auth{Token: "session-token"}, Start{})
	if err != nil || len(started.Resumes) != 1 {
		t.Fatalf("started = %+v err = %v", started, err)
	}
	if _, data, err := a.ResumeFile(context.Background(), started.SessionID, "r1"); err != nil || string(data) != "bytes" {
		t.Fatalf("file = %q err = %v", data, err)
	}
	for _, auth := range source.asked {
		if auth.Token != "session-token" {
			t.Fatalf("the source was asked with %+v", auth)
		}
	}
	if len(source.asked) != 2 {
		t.Fatalf("asked %d times, want the start and the file", len(source.asked))
	}
}

func TestARunServesOnlyTheFilesItWasToldAbout(t *testing.T) {
	source := &fakeSource{snapshot: applicant.Snapshot{Profile: `{}`, Resumes: []applicant.Resume{{ID: "mine", Stack: "Go", FileName: "go.pdf"}}}}
	a := sourceAgent(source)
	started, err := a.Start(context.Background(), "key", applicant.Auth{Token: "t"}, Start{})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.ResumeFile(context.Background(), started.SessionID, "someone-elses"); !errors.Is(err, applicant.ErrNoResume) {
		t.Fatalf("err = %v", err)
	}
	if len(source.fetched) != 0 {
		t.Fatalf("a file the run was not told about was fetched: %v", source.fetched)
	}
}

func TestASignedOutPersonCannotStartARun(t *testing.T) {
	a := sourceAgent(&fakeSource{err: applicant.ErrSignedOut})
	if _, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{}); !errors.Is(err, applicant.ErrSignedOut) {
		t.Fatalf("err = %v", err)
	}
}

func TestThePersonsOwnOpenRouterKeyInTheirProfileIsUsedWhenTheServerHasNone(t *testing.T) {
	source := &fakeSource{snapshot: applicant.Snapshot{Profile: `{}`, APIKey: "sk-or-theirs"}}
	a := sourceAgent(source)
	if _, err := a.Start(context.Background(), "", applicant.Auth{Token: "t"}, Start{}); err != nil {
		t.Fatalf("a profile key is enough: %v", err)
	}
	empty := sourceAgent(&fakeSource{snapshot: applicant.Snapshot{Profile: `{}`}})
	if _, err := empty.Start(context.Background(), "", applicant.Auth{Token: "t"}, Start{}); !errors.Is(err, llm.ErrNoKey) {
		t.Fatalf("no key anywhere: %v", err)
	}
}
