package agent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

func stopAnswer(reason string) reply {
	return reply{Status: StatusNeedPerson, Stop: &StopInfo{Reason: reason}}
}

func stopObs(t *testing.T) Observation {
	obs := observation(shot(t, 40))
	return obs
}

func TestARealChallengeTheScreenShowsIsAStopThatStands(t *testing.T) {
	for reason, need := range map[string]string{StopCaptcha: needCaptcha, StopVerification: needCode, StopVerificationLink: needLink, StopDocument: needDocument, StopIdentity: needIdentity} {
		a, id := newDOMAgent(t, &domScreen{need: need, needSure: 0.9}, false)
		s, _ := a.sessions.get(id)
		if note, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(reason)); held {
			t.Fatalf("%s: a confirmed stop was sent back: %s", reason, note)
		}
	}
}

func TestAStopTheScreenDoesNotShowIsSentBackWithANote(t *testing.T) {
	for _, reason := range []string{StopCaptcha, StopVerification, StopVerificationLink, StopDocument, StopIdentity} {
		screen := &domScreen{} // none
		a, id := newDOMAgent(t, screen, false)
		s, _ := a.sessions.get(id)
		note, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(reason))
		if !held || !strings.Contains(note, "Do not stop for the applicant") {
			t.Fatalf("%s: held %v, note %q", reason, held, note)
		}
		if len(screen.requests) != 1 || s.usage.Checks != 1 || s.usage.Calls != 0 {
			t.Fatalf("%s: one decision-model check and no driving call: requests %d, usage %+v", reason, len(screen.requests), s.usage)
		}
	}
}

func TestAStopForACaptchaTheModelIsHalfSureOfIsSentBack(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{need: needCaptcha, needSure: 0.5}, false)
	s, _ := a.sessions.get(id)
	if _, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(StopCaptcha)); !held {
		t.Fatal("a stop confirmed at 0.5 stood")
	}
}

func TestTheStopsNoScreenCanConfirmAreSentBackWithoutAnyCheck(t *testing.T) {
	for _, reason := range []string{StopOther, StopPageProblem, ""} {
		screen := &domScreen{need: needCaptcha, needSure: 0.99}
		a, id := newDOMAgent(t, screen, false)
		s, _ := a.sessions.get(id)
		if _, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(reason)); !held {
			t.Fatalf("%q: a stop nothing can confirm stood", reason)
		}
		if len(screen.requests) != 0 {
			t.Fatalf("%q: the screen was asked", reason)
		}
	}
}

func TestASignInStopStandsOnlyWhenTheProfileHasNoPassword(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{}, false)
	s, _ := a.sessions.get(id)
	s.snap.Secrets = map[string]string{applicant.AccountPasswordToken: "Real-Passw0rd!"}
	note, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(StopSignIn))
	if !held || !strings.Contains(note, applicant.AccountPasswordToken) {
		t.Fatalf("with a password: held %v, %q", held, note)
	}
	b, id2 := newDOMAgent(t, &domScreen{}, false)
	s2, _ := b.sessions.get(id2)
	s2.snap.Secrets = nil
	if _, held := b.holdUnneededStop(context.Background(), s2, stopObs(t), StatusNeedPerson, stopAnswer(StopSignIn)); held {
		t.Fatal("a sign-in stop with no password in the profile was sent back")
	}
}

func TestAStopThatComesAgainAfterTheSendBacksAreUsedStands(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{}, false)
	s, _ := a.sessions.get(id)
	for i := 0; i < a.cfg.StopOverridePasses; i++ {
		if _, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(StopCaptcha)); !held {
			t.Fatalf("send back %d did not happen", i+1)
		}
	}
	if _, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(StopCaptcha)); held {
		t.Fatal("a run was sent back more than its passes: it could loop on its stops")
	}
}

func TestACheckThatCannotBeMadeLetsTheStopStand(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{err: errors.New("the decision model is down")}, false)
	s, _ := a.sessions.get(id)
	if _, held := a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(StopCaptcha)); held {
		t.Fatal("a stop was sent back on a check that failed")
	}
	// Without a decision model there is nothing to check against.
	b := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	sid := start(t, b)
	bs, _ := b.sessions.get(sid)
	if _, held := b.holdUnneededStop(context.Background(), bs, stopObs(t), StatusNeedPerson, stopAnswer(StopCaptcha)); held {
		t.Fatal("a stop was sent back with no decision model")
	}
}

func TestOnlyAStopForThePersonIsChecked(t *testing.T) {
	screen := &domScreen{}
	a, id := newDOMAgent(t, screen, false)
	s, _ := a.sessions.get(id)
	for _, status := range []string{StatusWorking, StatusDone, StatusStuck} {
		if _, held := a.holdUnneededStop(context.Background(), s, stopObs(t), status, reply{Status: status, Stop: &StopInfo{Reason: StopCaptcha}}); held {
			t.Fatalf("%s was checked", status)
		}
	}
	if len(screen.requests) != 0 {
		t.Fatal("the screen was asked about something that is not a stop for the applicant")
	}
}

func TestTheStopCheckIsTracedWithWhatTheScreenSaid(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultConfig()
	cfg.TraceDir = dir
	a := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, &domScreen{need: needCaptcha, needSure: 0.2}, cfg)
	started, _ := a.Start(context.Background(), "key", applicant.Auth{}, Start{Prefill: true, Trace: true})
	s, _ := a.sessions.get(started.SessionID)
	a.holdUnneededStop(context.Background(), s, stopObs(t), StatusNeedPerson, stopAnswer(StopCaptcha))
	trace := s.takeTrace()
	if trace == nil {
		t.Fatal("no trace")
	}
	text := ""
	for _, file := range trace.Files {
		text += file.Text
	}
	if !strings.Contains(text, `"source": "stopcheck"`) || !strings.Contains(text, "stop check: captcha asked") {
		t.Fatalf("trace:\n%s", text)
	}
}
