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
	matcher := &fakeMatcher{match: selector.PostingMatch{IsPosting: true, Ranked: []selector.Ranked{{ID: "java", Probability: 0.4}}}}
	rec, err := svc.Recommend(context.Background(), "a", "Java engineer with Spring", "job-1", matcher)
	if err != nil || rec.ResumeID != "java" || rec.Stack != "Java + NodeJS" || len(rec.Top) != 1 {
		t.Fatalf("recommend = %+v %v", rec, err)
	}
	if len(matcher.seen) != 1 || !strings.Contains(matcher.seen[0].Description, "Skills: Spring") {
		t.Fatalf("candidates = %+v", matcher.seen)
	}
	if svc.store.jobFile("a", "job-1") != "java" {
		t.Fatal("pick should be remembered for the job")
	}
}

func TestRecommendRefusesNonPosting(t *testing.T) {
	svc := libraryService()
	if _, err := svc.Recommend(context.Background(), "a", "Sign in", "", &fakeMatcher{}); !errors.Is(err, ErrNoPosting) {
		t.Fatalf("non-posting err = %v", err)
	}
}
