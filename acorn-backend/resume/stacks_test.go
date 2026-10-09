package resume

import (
	"context"
	"errors"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

func putFile(t *testing.T, svc *Service, row LibraryRow) {
	t.Helper()
	row.AccountID = "a"
	if row.Source == "" {
		row.Source = "uploaded"
	}
	row.Bytes = []byte("file " + row.ID)
	row.MimeType = mimeFromName(row.FileName)
	if err := svc.store.putLibrary(row); err != nil {
		t.Fatal(err)
	}
}

// A stack's PDF and Word files are one résumé: Recommend ranks it once, and its
// file comes as the PDF with the Word version alongside.
func TestStackFilesAreOneCandidateWithThePDFFirst(t *testing.T) {
	svc := New(NewMemory(), nil)
	putFile(t, svc, LibraryRow{ID: "go-docx", Title: "Go", FileName: "go.docx", Analyzed: true,
		SkillProfile: []SkillEntry{{Name: "Go", Category: "hard", Level: 5}}})
	putFile(t, svc, LibraryRow{ID: "go-pdf", Title: " go ", FileName: "go.pdf"})
	putFile(t, svc, LibraryRow{ID: "cover", Title: "Go", FileName: "cover.pdf", Kind: KindCoverLetter})

	matcher := &fakeMatcher{match: selector.PostingMatch{IsPosting: true, Ranked: []selector.Ranked{{ID: "go-docx", Probability: 0.9}}}}
	rec, err := svc.Recommend(context.Background(), "a", "Go engineer", "", matcher)
	if err != nil || len(matcher.seen) != 1 {
		t.Fatalf("recommend = %+v err = %v candidates = %+v, want one candidate for the stack", rec, err, matcher.seen)
	}
	file, err := svc.LibraryFile("a", rec.ResumeID)
	if err != nil || file.Format != FormatPDF || len(file.Variants) != 1 || file.Variants[0].Format != FormatDOCX {
		t.Fatalf("file = %+v err = %v, want the PDF with the DOCX as a variant", file, err)
	}
	if file.Key != fileKeyResume || file.Kind != KindResume {
		t.Fatalf("file key = %q kind = %q", file.Key, file.Kind)
	}
}

func TestCoverLetterUsesTheOnlyOneWithoutAsking(t *testing.T) {
	svc := New(NewMemory(), nil)
	putFile(t, svc, LibraryRow{ID: "letter", Title: "General", FileName: "letter.docx", Kind: KindCoverLetter})
	matcher := &fakeMatcher{}
	pick, err := svc.CoverLetter(context.Background(), "a", "Go engineer", matcher)
	if err != nil || pick.File.ResumeID != "letter" || pick.File.Key != fileKeyCoverLetter || matcher.seen != nil {
		t.Fatalf("pick = %+v err = %v asked = %v", pick, err, matcher.seen != nil)
	}
}

func TestCoverLetterRanksSeveralAgainstThePosting(t *testing.T) {
	svc := New(NewMemory(), nil)
	putFile(t, svc, LibraryRow{ID: "backend", Title: "Backend", FileName: "backend.pdf", Kind: KindCoverLetter, IsPrimary: true})
	putFile(t, svc, LibraryRow{ID: "frontend", Title: "Frontend", FileName: "frontend.pdf", Kind: KindCoverLetter})
	matcher := &fakeMatcher{match: selector.PostingMatch{IsPosting: true, Ranked: []selector.Ranked{{ID: "frontend", Probability: 0.8}}}}
	pick, err := svc.CoverLetter(context.Background(), "a", "React engineer", matcher)
	if err != nil || pick.Stack != "Frontend" || len(matcher.seen) != 2 {
		t.Fatalf("pick = %+v err = %v seen = %d", pick, err, len(matcher.seen))
	}
	// No posting to read: the primary one.
	pick, err = svc.CoverLetter(context.Background(), "a", "", matcher)
	if err != nil || pick.Stack != "Backend" {
		t.Fatalf("pick = %+v err = %v, want the primary", pick, err)
	}
}

func TestCoverLetterWithNoneInTheLibrary(t *testing.T) {
	svc := New(NewMemory(), nil)
	putFile(t, svc, LibraryRow{ID: "resume", Title: "Go", FileName: "go.pdf"})
	if _, err := svc.CoverLetter(context.Background(), "a", "Go engineer", &fakeMatcher{}); !errors.Is(err, ErrNoCoverLetter) {
		t.Fatalf("err = %v, want ErrNoCoverLetter", err)
	}
}

func TestUploadRejectsAnUnknownKind(t *testing.T) {
	svc := New(NewMemory(), nil)
	if _, err := svc.UploadLibrary("a", "x.pdf", "X", "portfolio", []byte("x"), ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}
