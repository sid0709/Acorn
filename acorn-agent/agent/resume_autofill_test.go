package agent

import (
	"strings"
	"testing"
	"time"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

func TestThePromptTellsTheModelToUseAResumeAutofillFirstAndCheckItsWork(t *testing.T) {
	text, err := systemPrompt(Start{}, applicant.Snapshot{}, 12, 6, true, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(text, "# Résumé autofill")
	if start < 0 {
		t.Fatal("the prompt has no résumé autofill section")
	}
	section := text[start:]
	if end := strings.Index(section[2:], "\n# "); end >= 0 {
		section = section[:end+2]
	}
	for _, want := range []string{"before typing any field", "upload, never click", "check every field", "Only a file from this computer"} {
		if !strings.Contains(section, want) {
			t.Fatalf("the autofill section lacks %q:\n%s", want, section)
		}
	}
}
