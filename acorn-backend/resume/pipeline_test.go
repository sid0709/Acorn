package resume

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/openai"
)

var testIdentity = Identity{
	FullName: "Jordan Lee",
	Careers: []CareerEntry{
		{Company: "Acme Corp", Title: "Backend Engineer", Period: "2020-2023", Description: "Built APIs"},
		{Company: "Globex", Title: "Developer", Period: "2018-2020"},
	},
}

// scriptedModel answers by section and records every call. It is conversational, like the real client.
type scriptedModel struct {
	mu    sync.Mutex
	calls []scriptedCall
	reply func(system string, turns []openai.Message, schema string) string
}

type scriptedCall struct {
	system string
	turns  []openai.Message
}

func (m *scriptedModel) Model() string { return "scripted" }
func (m *scriptedModel) Ready() bool   { return true }
func (m *scriptedModel) JSON(ctx context.Context, system, user string, schema json.RawMessage) ([]byte, error) {
	return m.Conversation(ctx, system, []openai.Message{{Role: openai.RoleUser, Content: user}}, schema)
}
func (m *scriptedModel) Conversation(_ context.Context, system string, turns []openai.Message, schema json.RawMessage) ([]byte, error) {
	m.mu.Lock()
	m.calls = append(m.calls, scriptedCall{system: system, turns: append([]openai.Message(nil), turns...)})
	m.mu.Unlock()
	return []byte(m.reply(system, turns, string(schema))), nil
}

func goodReply(_ string, turns []openai.Message, schema string) string {
	switch {
	case strings.Contains(schema, `"draft"`):
		return `{"draft":"notes"}`
	case strings.Contains(schema, `"summary"`):
		return `{"summary":"Builds backends."}`
	case strings.Contains(schema, `"skills"`):
		return `{"skills":[{"category":"Go","items":["HTTP"]}]}`
	}
	return `{"experiences":[{"company":"Acme Corp","title":"Staff Backend/Go Engineer","bullets":["Shipped"]},{"company":"Globex","title":"Dev","bullets":["Built"]}]}`
}

func runWith(t *testing.T, cfg map[string]any, jobID string, model Model) (Task, *Service) {
	t.Helper()
	svc := New(nil, model)
	svc.RunInline()
	if cfg != nil {
		if _, err := svc.SaveConfig("a1", cfg); err != nil {
			t.Fatal(err)
		}
	}
	task, err := svc.Enqueue(context.Background(), "a1", testIdentity, "Build Go services", jobID, nil, model)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	return task, svc
}

func TestApplyTokens(t *testing.T) {
	tokens := buildTokenMap(testIdentity, "the jd", "Go, SQL")
	got, err := applyTokens("{JOB_DESCRIPTION} / {job_skills} / {company1} / {company9}.", tokens)
	if err != nil {
		t.Fatal(err)
	}
	want := "the jd / Go, SQL / Backend Engineer at Acme Corp (2020-2023) — Built APIs / ."
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if _, err := applyTokens("use {made_up} and {nope}", tokens); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "{made_up}, {nope}") {
		t.Fatalf("unknown tokens: %v", err)
	}
	if got, _ := applyTokens(`schema {"a": 1}`, tokens); got != `schema {"a": 1}` {
		t.Fatalf("json braces changed: %q", got)
	}
	if career := tokens["career"]; career != "Backend Engineer | Acme Corp | 2020-2023 — Built APIs\nDeveloper | Globex | 2018-2020" {
		t.Fatalf("career token = %q", career)
	}
}

func TestStepsFromConfig(t *testing.T) {
	steps, err := stepsFromConfig(map[string]any{})
	if err != nil || len(steps) != 3 {
		t.Fatalf("defaults: %v %d", err, len(steps))
	}
	partial := map[string]any{"steps": []any{map[string]any{"purpose": "summary", "kind": "final", "name": "S"}}}
	steps, err = stepsFromConfig(partial)
	if err != nil || len(steps) != 3 || steps[0].Prompt == "" {
		t.Fatalf("missing finals should be added with default prompts: %v %+v", err, steps)
	}
	twice := map[string]any{"steps": []any{
		map[string]any{"purpose": "summary", "kind": "final"},
		map[string]any{"purpose": "summary", "kind": "final"},
	}}
	if _, err := stepsFromConfig(twice); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "exactly one final") {
		t.Fatalf("two finals: %v", err)
	}
	blank := map[string]any{"steps": []any{map[string]any{"purpose": "skills", "kind": "fine-tune", "name": "Notes"}}}
	if _, err := stepsFromConfig(blank); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "needs a prompt") {
		t.Fatalf("blank fine-tune: %v", err)
	}
	bad := map[string]any{"steps": []any{map[string]any{"purpose": "summary", "kind": "final", "schema": "{nope"}}}
	if _, err := stepsFromConfig(bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad schema: %v", err)
	}
}

func TestFinalSchemaClosesObjects(t *testing.T) {
	raw, err := finalSchema("skills", `{"type":"object","properties":{"a":{"type":"array","items":{"type":"object","properties":{"b":{"type":"string"}}}}}}`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(raw), `"additionalProperties":false`) != 2 {
		t.Fatalf("both objects should be closed: %s", raw)
	}
}

func TestReconcileExperience(t *testing.T) {
	model := map[string]any{"experiences": []any{
		map[string]any{"company": "globex inc", "title": "Staff/Principal Dev", "period": "2019", "bullets": []any{"Built"}},
		map[string]any{"company": "Acme Corp", "title": "Senior Backend Engineer", "period": "x", "bullets": []any{"Shipped", " "}},
	}}
	fixed := asRecord(reconcileExperience(model, testIdentity.Careers, false))
	rows := asList(fixed["experiences"])
	first, second := asRecord(rows[0]), asRecord(rows[1])
	if first["company"] != "Acme Corp" || first["title"] != "Backend Engineer" || first["period"] != "2020-2023" {
		t.Fatalf("profile facts must win, in profile order: %v", first)
	}
	if len(asList(first["bullets"])) != 1 {
		t.Fatalf("blank bullets dropped: %v", first["bullets"])
	}
	if second["company"] != "Globex" || second["title"] != "Developer" {
		t.Fatalf("close company names still match: %v", second)
	}
	dynamic := asRecord(reconcileExperience(model, testIdentity.Careers, true))
	rows = asList(dynamic["experiences"])
	if asRecord(rows[0])["title"] != "Senior Backend Engineer" {
		t.Fatalf("clean dynamic title accepted: %v", rows[0])
	}
	if asRecord(rows[1])["title"] != "Developer" {
		t.Fatalf("stacked dynamic title rejected: %v", rows[1])
	}
	if got := reconcileExperience(model, nil, false); asRecord(got)["experiences"] == nil {
		t.Fatal("no profile roles leaves the model's section alone")
	}
}

func TestAssertSections(t *testing.T) {
	good := map[string]any{
		"summary":    map[string]any{"summary": "x"},
		"skills":     map[string]any{"skills": []any{map[string]any{"items": []any{"Go"}}}},
		"experience": map[string]any{"experiences": []any{map[string]any{"company": "A", "bullets": []any{"b"}}, map[string]any{"company": "B", "bullets": []any{"b"}}}},
	}
	if err := assertSections(good, testIdentity.Careers); err != nil {
		t.Fatal(err)
	}
	short := cloneMap(good)
	short["experience"] = map[string]any{"experiences": []any{map[string]any{"company": "A", "bullets": []any{"b"}}}}
	if err := assertSections(short, testIdentity.Careers); err == nil || !strings.Contains(err.Error(), "missing a profile role") {
		t.Fatalf("dropped role: %v", err)
	}
	bare := cloneMap(good)
	bare["experience"] = map[string]any{"experiences": []any{map[string]any{"company": "A", "title": "T", "bullets": []any{}}, map[string]any{"company": "B", "bullets": []any{"b"}}}}
	if err := assertSections(bare, testIdentity.Careers); err == nil || !strings.Contains(err.Error(), "T at A needs at least one bullet") {
		t.Fatalf("empty role: %v", err)
	}
	noSummary := cloneMap(good)
	delete(noSummary, "summary")
	if err := assertSections(noSummary, nil); err == nil {
		t.Fatal("missing summary must fail")
	}
}

func TestRunDefaultStepsKeepsProfileFacts(t *testing.T) {
	model := &scriptedModel{reply: goodReply}
	task, svc := runWith(t, nil, "", model)
	done, _ := svc.Poll("a1", task.ID)
	if done.Status != "completed" {
		t.Fatalf("status %q: %s", done.Status, done.Error)
	}
	if len(model.calls) != 3 {
		t.Fatalf("one call per section, got %d", len(model.calls))
	}
	for _, call := range model.calls {
		if !strings.Contains(call.system, "CANDIDATE PROFILE") || !strings.HasPrefix(call.system, defaultSystemInstruction) {
			t.Fatalf("system message lacks the instruction and profile: %q", call.system)
		}
		if !strings.Contains(call.system, "OPTIONAL CAREER DETAILS — 1 career description is blank") {
			t.Fatalf("blank career notice missing: %q", call.system)
		}
	}
	gen, err := svc.Generation("a1", done.GenerationID)
	if err != nil {
		t.Fatal(err)
	}
	row := asRecord(asList(asRecord(gen.Sections["experience"])["experiences"])[0])
	if row["title"] != "Backend Engineer" {
		t.Fatalf("a stacked model title must not reach the résumé: %v", row["title"])
	}
	var experience string
	for _, call := range model.calls {
		if last := call.turns[len(call.turns)-1].Content; strings.Contains(last, "TITLE POLICY") {
			experience = last
		}
	}
	if !strings.Contains(experience, "dynamic career titles disabled") || !strings.Contains(experience, "Return exactly 2 experience objects") {
		t.Fatalf("experience prompt lacks the title policy: %q", experience)
	}
}

func TestRunFineTuneSeesDraftAndPriorTurns(t *testing.T) {
	cfg := map[string]any{
		"dynamicCareerTitles": true,
		"systemInstruction":   "You write for {job_description}.",
		"steps": []any{
			map[string]any{"purpose": "summary", "kind": "fine-tune", "name": "Notes", "prompt": "List the key asks in {job_description}."},
			map[string]any{"purpose": "summary", "kind": "final", "name": "Summary", "prompt": "Write it from {draft_summary}."},
		},
	}
	model := &scriptedModel{reply: goodReply}
	task, svc := runWith(t, cfg, "", model)
	if done, _ := svc.Poll("a1", task.ID); done.Status != "completed" {
		t.Fatalf("status %q: %s", done.Status, done.Error)
	}
	var final *scriptedCall
	for i, call := range model.calls {
		if strings.Contains(call.turns[len(call.turns)-1].Content, "Write it from") {
			final = &model.calls[i]
		}
	}
	if final == nil || len(final.turns) != 3 {
		t.Fatalf("final step should follow the fine-tune's two turns: %+v", final)
	}
	if !strings.Contains(final.turns[2].Content, "Write it from notes.") {
		t.Fatalf("{draft_summary} not filled: %q", final.turns[2].Content)
	}
	if !strings.HasPrefix(final.system, "You write for Build Go services.") {
		t.Fatalf("system instruction tokens: %q", final.system)
	}
	if got := len(task.Progress.Steps); got != 6 {
		t.Fatalf("progress rows = load + 2 summary + skills + experience + finalize = 6, got %d", got)
	}
}

func TestEnqueueRejectsBadPrompts(t *testing.T) {
	model := &scriptedModel{reply: goodReply}
	svc := New(nil, model)
	svc.RunInline()
	if _, err := svc.SaveConfig("a1", map[string]any{"steps": []any{
		map[string]any{"purpose": "summary", "kind": "final", "name": "Summary", "prompt": "Write {oops}."},
	}}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.Enqueue(context.Background(), "a1", testIdentity, "jd", "", nil, model)
	if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "{oops}") {
		t.Fatalf("a typo'd token should fail at enqueue: %v", err)
	}
	if len(model.calls) != 0 {
		t.Fatal("no model call before the prompts check out")
	}
}

func TestSkipForStructuredJobs(t *testing.T) {
	cfg := map[string]any{"steps": []any{
		map[string]any{"purpose": "skills", "kind": "fine-tune", "name": "Pick", "prompt": "Pick skills.", "skipForStructuredJobs": true},
	}}
	free := &scriptedModel{reply: goodReply}
	runWith(t, cfg, "", free)
	if len(free.calls) != 4 {
		t.Fatalf("free-text run keeps the step: %d calls", len(free.calls))
	}
	job := &scriptedModel{reply: goodReply}
	runWith(t, cfg, "job-1", job)
	if len(job.calls) != 3 {
		t.Fatalf("job run skips the step: %d calls", len(job.calls))
	}
}

func TestRunFailsOnIncompleteExperience(t *testing.T) {
	model := &scriptedModel{reply: func(_ string, _ []openai.Message, schema string) string {
		if strings.Contains(schema, `"experiences"`) {
			return `{"experiences":[{"company":"Acme Corp","title":"x","bullets":[]},{"company":"Globex","title":"y","bullets":["ok"]}]}`
		}
		return goodReply("", nil, schema)
	}}
	task, svc := runWith(t, nil, "", model)
	done, _ := svc.Poll("a1", task.ID)
	if done.Status != "failed" || !strings.Contains(done.Error, "Backend Engineer at Acme Corp needs at least one bullet") {
		t.Fatalf("status %q error %q", done.Status, done.Error)
	}
}
