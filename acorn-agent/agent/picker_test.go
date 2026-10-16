package agent

import (
	"context"
	"strings"
	"testing"
)

func attachClick() string {
	return plan("attaching my résumé", "notes", click(300, 400, nil))
}

func openedPicker(id string) []ActionResult {
	return []ActionResult{{ID: id, OK: true, Opened: OpenedFilePicker}}
}

func TestAClickThatOpenedAFilePickerIsToldToTheModel(t *testing.T) {
	model := &scriptedModel{replies: []string{attachClick(), plan("uploading", nil, map[string]any{"kind": "upload", "x": 300, "y": 400})}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig()) // no decision model: the model must do it
	id := startOnForm(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = openedPicker("s1a1")
	stepOK(t, a, id, obs)
	text := lastText(model)
	for _, want := range []string{"opened a file picker that you cannot see", "Use upload at that point"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
}

func TestTheAgentUploadsTheResumeItselfWhenTheControlTakesOne(t *testing.T) {
	model := &scriptedModel{replies: []string{attachClick(), plan("next", nil, click(1, 1, nil))}}
	screen := &fakeScreen{fileKind: fileResume, fileSure: 0.97}
	a := newAgentWithScreen(t, model, &fixedDecider{choice: "Ada"}, screen, DefaultConfig())
	id := startOnForm(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))

	obs := observation(shot(t, 90))
	obs.Results = openedPicker("s1a1")
	step := stepOK(t, a, id, obs)
	if len(step.Actions) != 1 || step.Actions[0].Kind != KindUpload || step.Actions[0].FileName == "" ||
		*step.Actions[0].X != 300 || *step.Actions[0].Y != 400 || model.count() != 1 {
		t.Fatalf("step = %+v, model calls %d", step, model.count())
	}
	// The checker was shown the page with the clicked control marked.
	request := screen.requests[0]
	if _, ok := request.Questions[askFileKind]; !ok || request.State[1].ImageURL == nil {
		t.Fatalf("request = %+v", request)
	}
	if step.Usage.Checks != 1 {
		t.Fatalf("usage = %+v", step.Usage)
	}

	// The model's next look says what the agent did, with the upload's result.
	next := observation(shot(t, 140))
	next.Results = []ActionResult{{ID: step.Actions[0].ID, OK: true, Detail: "Ada.pdf, 3 bytes, through the picker"}}
	stepOK(t, a, id, next)
	text := lastText(model)
	for _, want := range []string{"Acorn uploaded", "for you", "s1a1 done", "through the picker"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
}

func TestAControlForAnotherDocumentIsLeftToTheModel(t *testing.T) {
	for _, kind := range []string{fileCover, fileOther} {
		t.Run(kind, func(t *testing.T) {
			model := &scriptedModel{replies: []string{attachClick(), plan("choosing", nil, click(1, 1, nil))}}
			screen := &fakeScreen{fileKind: kind, fileSure: 0.99}
			a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
			id := startOnForm(t, a)
			stepOK(t, a, id, observation(shot(t, 40)))
			obs := observation(shot(t, 90))
			obs.Results = openedPicker("s1a1")
			step := stepOK(t, a, id, obs)
			if step.Message != "choosing" || model.count() != 2 {
				t.Fatalf("the model must decide: %+v, calls %d", step, model.count())
			}
			if text := lastText(model); !strings.Contains(text, "not your résumé") {
				t.Fatalf("the model is not told what the control takes:\n%s", text)
			}
		})
	}
}

func TestTheAgentUploadsAtAPointOnlyOnce(t *testing.T) {
	model := &scriptedModel{replies: []string{attachClick(), attachClick(), plan("again", nil, click(1, 1, nil))}}
	screen := &fakeScreen{fileKind: fileResume, fileSure: 0.99}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startOnForm(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = openedPicker("s1a1")
	first := stepOK(t, a, id, obs)
	if first.Actions[0].Kind != KindUpload {
		t.Fatalf("first = %+v", first)
	}
	// The model looks, clicks the same control again, and it opens a picker again: no second upload.
	obs = observation(shot(t, 140))
	obs.Results = []ActionResult{{ID: first.Actions[0].ID, OK: true}}
	second := stepOK(t, a, id, obs)
	obs = observation(shot(t, 190))
	obs.Results = openedPicker(second.Actions[0].ID)
	third, err := a.Step(context.Background(), id, obs)
	if err != nil {
		t.Fatal(err)
	}
	if third.Message != "again" || screen.calls() != 1 {
		t.Fatalf("third = %+v, checks %d", third, screen.calls())
	}
}

func TestAnUnsureCheckerLeavesTheUploadToTheModel(t *testing.T) {
	model := &scriptedModel{replies: []string{attachClick(), plan("deciding", nil, click(1, 1, nil))}}
	screen := &fakeScreen{fileKind: fileResume, fileSure: 0.5}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startOnForm(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = openedPicker("s1a1")
	if step := stepOK(t, a, id, obs); step.Message != "deciding" {
		t.Fatalf("step = %+v", step)
	}
}
