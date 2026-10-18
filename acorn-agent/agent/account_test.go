package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

func TestAControlThatSignsInThroughAnotherServiceIsBlocked(t *testing.T) {
	for p, want := range map[float64]bool{0.05: false, 0.49: false, 0.5: true, 0.95: true} {
		a, id := vetAgent(t, &fixedDecider{signOn: p})
		verdict, err := a.Vet(context.Background(), id, VetTarget{Kind: VetControl, Tag: "button", Text: "Continue with an account"})
		if err != nil || verdict.Blocked != want {
			t.Fatalf("p=%.2f: %+v err=%v, want blocked=%v", p, verdict, err, want)
		}
		if want && (verdict.Cause != CauseSingleSignOn || !strings.Contains(verdict.Reason, "another service")) {
			t.Fatalf("p=%.2f: the refusal does not say why: %+v", p, verdict)
		}
	}
}

func TestAWindowThatSignsInThroughAnotherServiceIsBlockedToo(t *testing.T) {
	a, id := vetAgent(t, &fixedDecider{signOn: 0.9})
	verdict, err := a.Vet(context.Background(), id, VetTarget{Kind: VetWindow, URL: "https://accounts.example/consent"})
	if err != nil || !verdict.Blocked || verdict.Cause != CauseSingleSignOn {
		t.Fatalf("verdict = %+v err = %v", verdict, err)
	}
}

func TestAnOnlineFileSourceKeepsItsOwnCauseWhenBothQuestionsSayYes(t *testing.T) {
	a, id := vetAgent(t, &fixedDecider{online: 0.9, signOn: 0.9})
	verdict, err := a.Vet(context.Background(), id, VetTarget{Kind: VetControl, Tag: "button", Text: "Pick from a drive"})
	if err != nil || !verdict.Blocked || verdict.Cause != CauseOnlineSource {
		t.Fatalf("verdict = %+v err = %v", verdict, err)
	}
}

func TestAnOrdinaryControlIsNeitherBlockedNorGivenACause(t *testing.T) {
	a, id := vetAgent(t, &fixedDecider{online: 0.02, signOn: 0.05})
	verdict, err := a.Vet(context.Background(), id, VetTarget{Kind: VetControl, Tag: "button", Text: "Sign in"})
	if err != nil || verdict.Blocked || verdict.Cause != "" {
		t.Fatalf("verdict = %+v err = %v", verdict, err)
	}
}

func TestTheDecisionModelIsAskedBothQuestionsInOneCall(t *testing.T) {
	decider := &fixedDecider{}
	a, id := vetAgent(t, decider)
	if _, err := a.Vet(context.Background(), id, VetTarget{Kind: VetControl, Tag: "button", Text: "Next"}); err != nil {
		t.Fatal(err)
	}
	if decider.calls != 1 {
		t.Fatalf("the checks took %d calls, want one", decider.calls)
	}
}

const accountProfile = `{"_id":{"$oid":"oid-1"},"accountId":"acct-1","profile":{"fullName":"Ada","email":"ada@example.com","defaultAccountPassword":"Hunter2!pass"}}`

func typePassword(label string) string {
	return answerJSON("working", label, map[string]any{"kind": "type", "text": applicant.AccountPasswordToken, "secret": true})
}

func TestARunThatKeepsTypingThePasswordEndsAsRejectedByTheSite(t *testing.T) {
	var replies []string
	for i := 0; i < 6; i++ {
		replies = append(replies, typePassword("trying"))
	}
	model := &scriptedModel{replies: replies}
	a := stackAgent(t, model, &fixedDecider{}, accountProfile)
	a.cfg.AccountAttempts = 3
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if err != nil {
		t.Fatal(err)
	}
	var last Step
	for i := 0; i < 6; i++ {
		last, err = a.Step(context.Background(), started.SessionID, observation(shot(t, uint8(30+i*30))))
		if err != nil {
			t.Fatal(err)
		}
		if last.Status != StatusWorking {
			break
		}
		if i >= 3 {
			t.Fatalf("step %d still ran after the attempts were used up", i+1)
		}
	}
	if last.Status != StatusStuck || last.Stop == nil || last.Stop.Reason != StopAccountRejected {
		t.Fatalf("the run did not end as rejected: %+v", last)
	}
	if len(last.Actions) != 0 {
		t.Fatalf("the ending step still acts: %+v", last.Actions)
	}
	if last.Stop.Action == "" || last.Stop.Problem == "" {
		t.Fatalf("the stop does not tell the person what to do: %+v", last.Stop)
	}
}

func TestStepsThatDoNotTypeThePasswordAreNotCounted(t *testing.T) {
	var replies []string
	for i := 0; i < 6; i++ {
		replies = append(replies, answerJSON("working", "waiting", map[string]any{"kind": "wait", "ms": 100}))
	}
	a := stackAgent(t, &scriptedModel{replies: replies}, &fixedDecider{}, accountProfile)
	a.cfg.AccountAttempts = 1
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		step, err := a.Step(context.Background(), started.SessionID, observation(shot(t, uint8(30+i*40))))
		if err != nil || step.Status != StatusWorking {
			t.Fatalf("step %d = %+v err = %v", i+1, step, err)
		}
	}
}
