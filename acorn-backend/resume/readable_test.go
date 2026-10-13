package resume

import (
	"strings"
	"testing"
)

const readableResume = "Jason Allen — Senior Machine Learning Engineer\nPython, PyTorch, LangChain, AWS SageMaker, Kubernetes"

// glyphJunk is what a PDF whose fonts store glyph numbers reads as without its
// character map: two-byte codes turned into control characters and stray bytes.
var glyphJunk = strings.Repeat("\x00\x2b\x00\x48\x00\x4f\x00\x4f\x00\x52\x00\x03", 40)

func TestReadableTextTellsWordsFromGlyphCodes(t *testing.T) {
	if !readableText(readableResume) {
		t.Fatal("a résumé's text read as unreadable")
	}
	if readableText(glyphJunk) {
		t.Fatal("glyph codes read as text")
	}
	if readableText("Python") {
		t.Fatal("a few characters read as a résumé")
	}
}

func TestBestResumeTextPrefersReadableOverLonger(t *testing.T) {
	// The longer text is junk: the browser's shorter, readable text wins.
	got := bestResumeText("cv.txt", []byte(glyphJunk), readableResume)
	if got != readableResume {
		t.Fatalf("got %q, want the browser's readable text", got)
	}
}

func TestBestResumeTextHealsAStoredUnreadableRead(t *testing.T) {
	// Stored text is junk and nothing else was sent: the file's own read is used.
	got := bestResumeText("cv.txt", []byte(readableResume), "", glyphJunk)
	if got != collapseSpace(readableResume) {
		t.Fatalf("got %q, want the file's readable text", got)
	}
}

func TestBestResumeTextIsEmptyWhenNothingReads(t *testing.T) {
	if got := bestResumeText("cv.txt", []byte(glyphJunk), glyphJunk); got != "" {
		t.Fatalf("got %q, want nothing", got)
	}
}
