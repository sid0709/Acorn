package agent

import (
	"strings"
	"testing"
)

func TestParseReplyReadsTheFirstObjectAndIgnoresWhatSurroundsIt(t *testing.T) {
	object := plan("hi", "notes", click(1, 1, nil))
	for name, content := range map[string]string{
		"a stray character after the object": object + "}",
		"a code fence":                       "```json\n" + object + "\n```",
		"words before the object":            "Here is my answer: " + object,
		"a second object":                    object + object,
	} {
		got, err := parseReply(content)
		if err != nil || got.Message != "hi" || len(got.Actions) != 1 {
			t.Errorf("%s: %+v %v", name, got, err)
		}
	}
	if _, err := parseReply(`{"status":"working"`); err == nil {
		t.Error("a cut-off answer must still be refused")
	}
	if _, err := parseReply(`{"status":"sleeping"}`); err == nil {
		t.Error("an unknown status must still be refused")
	}
}

func TestANullMemoKeepsTheNotes(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("one", "applying to Acme; name done", click(1, 1, nil)),
		plan("two", nil, click(2, 2, nil)),
		plan("three", nil, click(3, 3, nil)),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	for i, shade := range []uint8{40, 90, 140} {
		stepOK(t, a, id, observation(shot(t, shade)))
		_ = i
	}
	if text := lastText(model); !strings.Contains(text, "Your notes so far:\napplying to Acme; name done") {
		t.Fatalf("the notes were lost:\n%s", text)
	}
}
