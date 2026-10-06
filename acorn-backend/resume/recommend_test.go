package resume

import "testing"

func TestRecommendMatchesStackAndAnalyzedSkills(t *testing.T) {
	svc := New(NewMemory(), nil)
	svc.store.putLibrary(LibraryRow{
		ID: "java", AccountID: "a", Source: "uploaded", Title: "Java + NodeJS",
		SkillProfile: []SkillEntry{{Name: "Spring", Category: "hard", Level: 5}},
	})
	svc.store.putLibrary(LibraryRow{
		ID: "js", AccountID: "a", Source: "uploaded", Title: "JavaScript",
		SkillProfile: []SkillEntry{{Name: "React", Category: "hard", Level: 5}},
	})
	svc.store.putLibrary(LibraryRow{
		ID: "health", AccountID: "a", Source: "uploaded", Title: "Healthcare",
		SkillProfile: []SkillEntry{{Name: "HIPAA", Category: "domain", Level: 4}},
	})

	id, stack, reason, err := svc.Recommend("a", "We need a Java engineer with Spring Boot and Node.js", "")
	if err != nil {
		t.Fatal(err)
	}
	if id != "java" || stack != "Java + NodeJS" {
		t.Fatalf("recommend = %s %s (%s)", id, stack, reason)
	}
}

func TestRecommendDoesNotScanResumeBody(t *testing.T) {
	svc := New(NewMemory(), nil)
	svc.store.putLibrary(LibraryRow{
		ID: "health", AccountID: "a", Source: "uploaded", Title: "Healthcare",
		ExtractedText: "Built Java services for a hospital.",
	})
	svc.store.putLibrary(LibraryRow{
		ID: "java", AccountID: "a", Source: "uploaded", Title: "Java",
	})
	id, _, _, err := svc.Recommend("a", "Java backend role", "")
	if err != nil {
		t.Fatal(err)
	}
	if id != "java" {
		t.Fatalf("recommend id = %s, want java", id)
	}
}
