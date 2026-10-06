package resume

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

// fakeMatcher answers like the SelectorGateway and records what it was shown.
type fakeMatcher struct {
	match selector.PostingMatch
	seen  []selector.Candidate
}

func (f *fakeMatcher) MatchPosting(_ context.Context, _ string, candidates []selector.Candidate) (selector.PostingMatch, error) {
	f.seen = candidates
	return f.match, nil
}

func libraryService() *Service {
	svc := New(NewMemory(), nil)
	svc.store.putLibrary(LibraryRow{
		ID: "java", AccountID: "a", Source: "uploaded", Title: "Java + NodeJS",
		SkillProfile: []SkillEntry{{Name: "Spring", Category: "hard", Level: 5}},
	})
	svc.store.putLibrary(LibraryRow{ID: "gen", AccountID: "a", Source: "generated", Title: "Generated"})
	return svc
}

func TestRecommendSendsUploadsAndReturnsThePick(t *testing.T) {
	svc := libraryService()
	matcher := &fakeMatcher{match: selector.PostingMatch{IsPosting: true, ID: "java", Confidence: 0.9}}
	id, stack, _, err := svc.Recommend(context.Background(), "a", "Java engineer with Spring", "job-1", matcher)
	if err != nil || id != "java" || stack != "Java + NodeJS" {
		t.Fatalf("recommend = %q %q %v", id, stack, err)
	}
	if len(matcher.seen) != 1 || !strings.Contains(matcher.seen[0].Description, "Skills: Spring") {
		t.Fatalf("candidates = %+v", matcher.seen)
	}
	if svc.store.jobFile("a", "job-1") != "java" {
		t.Fatal("pick should be remembered for the job")
	}
}

func TestRecommendRefusesNonPostingAndNoFit(t *testing.T) {
	svc := libraryService()
	if _, _, _, err := svc.Recommend(context.Background(), "a", "Sign in", "", &fakeMatcher{}); !errors.Is(err, ErrNoPosting) {
		t.Fatalf("non-posting err = %v", err)
	}
	noFit := &fakeMatcher{match: selector.PostingMatch{IsPosting: true}}
	if _, _, _, err := svc.Recommend(context.Background(), "a", "Nurse role", "", noFit); !errors.Is(err, ErrNoLibrary) {
		t.Fatalf("no-fit err = %v", err)
	}
}
