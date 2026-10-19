package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
)

// agentWithProfile is an agent whose applicant profile is the given JSON, with one model that drives on OpenRouter
// and one that drives on OpenAI, so a test can see which the run used.
func agentWithProfile(t *testing.T, profile string, openRouter, openAI *scriptedModel) *Agent {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, applicant.ProfileFile), []byte(profile), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, applicant.ResumeDir, "data", "Ada.pdf")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("pdf"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := DefaultConfig()
	a := New(cfg, applicant.NewStore(dir),
		func(string) llm.Model { return openRouter },
		func(string) Decider { return &fixedDecider{} },
		nil)
	return a.WithOpenAI(func(string) llm.Model { return openAI })
}

func TestARunWithAnOpenAIKeyIsDrivenOnItAndOneWithoutIsNot(t *testing.T) {
	openRouter := &scriptedModel{replies: []string{planReply(planned(3, "fill", "Full name", "Ada Lovelace")), classified()}}
	openAI := &scriptedModel{replies: []string{planReply(planned(3, "fill", "Full name", "Ada Lovelace")), classified()}}
	a := agentWithProfile(t, `{"name":"Ada Lovelace","openaiApiKey":"sk-proj-test"}`, openRouter, openAI)
	id := startWithPrefill(t, a)
	if _, err := a.Prefill(context.Background(), id, treeRequest()); err != nil {
		t.Fatal(err)
	}
	if openAI.count() != 2 || openRouter.count() != 0 {
		t.Fatalf("a run with an OpenAI key is driven on it: OpenAI %d calls, OpenRouter %d", openAI.count(), openRouter.count())
	}

	openRouter = &scriptedModel{replies: []string{planReply(planned(3, "fill", "Full name", "Ada Lovelace")), classified()}}
	openAI = &scriptedModel{}
	a = agentWithProfile(t, `{"name":"Ada Lovelace"}`, openRouter, openAI)
	id = startWithPrefill(t, a)
	if _, err := a.Prefill(context.Background(), id, treeRequest()); err != nil {
		t.Fatal(err)
	}
	if openRouter.count() != 2 || openAI.count() != 0 {
		t.Fatalf("a run without one is driven on OpenRouter: OpenRouter %d calls, OpenAI %d", openRouter.count(), openAI.count())
	}
}

func TestTheOpenAIKeyNeverReachesTheModelAndAStartWithOnlyItIsAllowed(t *testing.T) {
	openAI := &scriptedModel{replies: []string{planReply(), classified()}}
	a := agentWithProfile(t, `{"name":"Ada Lovelace","openaiApiKey":"sk-proj-secret"}`, &scriptedModel{}, openAI)
	// No OpenRouter key at all: the run still begins, since the model that drives it has a key.
	started, err := a.Start(context.Background(), "", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Prefill: true})
	if err != nil {
		t.Fatalf("a profile with only an OpenAI key can start: %v", err)
	}
	if _, err := a.Prefill(context.Background(), started.SessionID, treeRequest()); err != nil {
		t.Fatal(err)
	}
	for _, request := range openAI.requests {
		for _, message := range request.Messages {
			if containsAny(message.Text, "sk-proj-secret") {
				t.Fatalf("the model was shown the key: %s", message.Text)
			}
		}
	}
	// And a profile with neither key cannot.
	a = agentWithProfile(t, `{"name":"Ada Lovelace"}`, &scriptedModel{}, &scriptedModel{})
	if _, err := a.Start(context.Background(), "", applicant.Auth{}, Start{URL: "https://jobs.example/apply"}); err == nil {
		t.Fatal("a run with no key at all must not start")
	}
}

func containsAny(text string, needles ...string) bool {
	for _, needle := range needles {
		if needle != "" && strings.Contains(text, needle) {
			return true
		}
	}
	return false
}
