package agent

import (
	"context"
	"strings"
	"testing"
)

func vetAgent(t *testing.T, decider *fixedDecider) (*Agent, string) {
	t.Helper()
	a := newTestAgent(t, &scriptedModel{}, decider, DefaultConfig())
	return a, start(t, a)
}

func TestAControlThatLooksLikeAnOnlineFileSourceIsBlocked(t *testing.T) {
	decider := &fixedDecider{online: 0.95}
	a, id := vetAgent(t, decider)
	verdict, err := a.Vet(context.Background(), id, VetTarget{
		Kind: VetControl, Tag: "button", Text: "Dropbox", InFileComponent: true, PageURL: "https://jobs.example/apply",
	})
	if err != nil || !verdict.Blocked || verdict.Reason == "" || verdict.Probability != 0.95 {
		t.Fatalf("verdict = %+v err = %v", verdict, err)
	}
	// The decision model is shown what the control says of itself, and nothing else.
	state := decider.vetStates[0]
	for _, want := range []string{"Text: Dropbox", "Element: button", "It sits in a file upload component.", "On the page: https://jobs.example/apply"} {
		if !strings.Contains(state, want) {
			t.Fatalf("missing %q in:\n%s", want, state)
		}
	}
}

func TestADoubtfulControlIsClickedAndASureOneIsBlocked(t *testing.T) {
	// A control that is only possibly an online source is clicked: what it opens is judged on its own.
	for p, want := range map[float64]bool{0.02: false, 0.3: false, 0.38: false, 0.59: false, 0.6: true, 0.95: true} {
		a, id := vetAgent(t, &fixedDecider{online: p})
		verdict, err := a.Vet(context.Background(), id, VetTarget{Kind: VetControl, Tag: "button", Text: "Attach"})
		if err != nil || verdict.Blocked != want {
			t.Fatalf("p=%.2f: %+v err=%v, want blocked=%v", p, verdict, err, want)
		}
	}
}

func TestADoubtfulWindowIsStillClosed(t *testing.T) {
	for p, want := range map[float64]bool{0.29: false, 0.3: true, 0.6: true} {
		a, id := vetAgent(t, &fixedDecider{online: p})
		verdict, err := a.Vet(context.Background(), id, VetTarget{Kind: VetWindow, URL: "https://files.example/pick"})
		if err != nil || verdict.Blocked != want {
			t.Fatalf("p=%.2f: %+v err=%v, want blocked=%v", p, verdict, err, want)
		}
	}
}

func TestAControlThatCannotBeCheckedIsBlockedOnlyInsideAFileComponent(t *testing.T) {
	a, id := vetAgent(t, &fixedDecider{onlineFail: true})
	inside, err := a.Vet(context.Background(), id, VetTarget{Kind: VetControl, Tag: "button", Text: "Attach", InFileComponent: true})
	if err != nil || !inside.Blocked {
		t.Fatalf("inside = %+v err = %v", inside, err)
	}
	outside, err := a.Vet(context.Background(), id, VetTarget{Kind: VetControl, Tag: "button", Text: "Next"})
	if err != nil || outside.Blocked {
		t.Fatalf("outside = %+v err = %v", outside, err)
	}
	// A window that cannot be judged is let be: a failed check must not close every page.
	window, err := a.Vet(context.Background(), id, VetTarget{Kind: VetWindow, URL: "https://ats.example/apply"})
	if err != nil || window.Blocked {
		t.Fatalf("window = %+v err = %v", window, err)
	}
}

func TestAWindowThatOpenedIsDescribedByItsAddressTitleAndText(t *testing.T) {
	decider := &fixedDecider{online: 0.9}
	a, id := vetAgent(t, decider)
	verdict, err := a.Vet(context.Background(), id, VetTarget{
		Kind: VetWindow, URL: "https://files.example/chooser", Title2: "Sign in", Excerpt: "Choose a file from your cloud storage",
	})
	if err != nil || !verdict.Blocked {
		t.Fatalf("verdict = %+v err = %v", verdict, err)
	}
	for _, want := range []string{"A new browser window opened", "Address: https://files.example/chooser", "Title: Sign in", "cloud storage"} {
		if !strings.Contains(decider.vetStates[0], want) {
			t.Fatalf("missing %q in:\n%s", want, decider.vetStates[0])
		}
	}
}

func TestTheSameControlIsJudgedOncePerRunAndCounted(t *testing.T) {
	decider := &fixedDecider{online: 0.01}
	a, id := vetAgent(t, decider)
	target := VetTarget{Kind: VetControl, Tag: "button", Text: "Submit"}
	for i := 0; i < 3; i++ {
		if _, err := a.Vet(context.Background(), id, target); err != nil {
			t.Fatal(err)
		}
	}
	if len(decider.vetStates) != 1 {
		t.Fatalf("judged %d times, want once", len(decider.vetStates))
	}
}

func TestVetOfAnUnknownRunIsRefused(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	if _, err := a.Vet(context.Background(), "nope", VetTarget{Kind: VetControl}); err == nil {
		t.Fatal("expected an error")
	}
}
