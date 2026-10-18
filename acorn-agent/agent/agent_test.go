package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
	"github.com/sid0709/acorn/acorn-backend/jev"
)

// scriptedModel answers each call with the next canned reply and records every request.
type scriptedModel struct {
	mu       sync.Mutex
	replies  []string
	requests []llm.Request
	err      error
}

func (m *scriptedModel) Name() string { return "scripted" }

func (m *scriptedModel) Complete(_ context.Context, req llm.Request) (llm.Response, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests = append(m.requests, req)
	if m.err != nil {
		return llm.Response{}, m.err
	}
	if len(m.replies) == 0 {
		return llm.Response{}, errors.New("no scripted reply left")
	}
	content := m.replies[0]
	m.replies = m.replies[1:]
	return llm.Response{Content: content, Usage: llm.Usage{InputTokens: 100, OutputTokens: 10, Cost: 0.001}}, nil
}

type fixedDecider struct {
	choice string
	err    error
	calls  int
	// jd is the probability the decision model gives that a page text is a job description; states
	// are the texts it was asked about, and choiceStates the descriptions it chose a résumé from.
	jd           float64
	states       []string
	choiceStates []string
	// online is the probability the decision model gives that a described control or window is
	// an online file source; vetStates are the descriptions it was asked about.
	online     float64
	vetStates  []string
	onlineFail bool
	// signOn is the probability it gives that a described control or window signs in through
	// another service's account.
	signOn float64
}

func (d *fixedDecider) Decide(_ context.Context, req jev.Request) (jev.Response, error) {
	d.calls++
	if d.err != nil {
		return jev.Response{}, d.err
	}
	answers := map[string]jev.Answer{}
	if _, ok := req.Questions[askJobDescription]; ok {
		p := d.jd
		d.states = append(d.states, req.State)
		answers[askJobDescription] = jev.Answer{Type: jev.TypeNoul, Noul: &p}
	}
	if _, ok := req.Questions[askOnlineSource]; ok {
		if d.onlineFail {
			return jev.Response{}, errors.New("the decision model is down")
		}
		p := d.online
		d.vetStates = append(d.vetStates, req.State)
		answers[askOnlineSource] = jev.Answer{Type: jev.TypeNoul, Noul: &p}
	}
	if _, ok := req.Questions[askSingleSignOn]; ok {
		p := d.signOn
		answers[askSingleSignOn] = jev.Answer{Type: jev.TypeNoul, Noul: &p}
	}
	if _, ok := req.Questions[resumeQuestion]; ok {
		d.choiceStates = append(d.choiceStates, req.State)
		answers[resumeQuestion] = jev.Answer{Type: jev.TypeChoice, Choice: d.choice}
	}
	return jev.Response{Answers: answers}, nil
}

// shot is a flat screenshot: shade picks its brightness, marks paint dark blocks on it.
func shot(t *testing.T, shade uint8, marks ...image.Rectangle) string {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, 1280, 800))
	for i := range img.Pix {
		img.Pix[i] = shade
	}
	for _, mark := range marks {
		for y := mark.Min.Y; y < mark.Max.Y; y++ {
			for x := mark.Min.X; x < mark.Max.X; x++ {
				img.SetGray(x, y, color.Gray{Y: 0})
			}
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func observation(screenshot string) Observation {
	return Observation{
		Screenshot: screenshot, URL: "https://jobs.example/apply", Title: "Apply",
		Viewport: Viewport{Width: 1280, Height: 800, PageWidth: 1280, PageHeight: 800},
	}
}

func answerJSON(status, message string, actions ...map[string]any) string {
	full := make([]map[string]any, 0, len(actions))
	for _, action := range actions {
		item := map[string]any{"x": nil, "y": nil, "text": nil, "secret": nil, "keys": nil, "dx": nil, "dy": nil, "ms": nil, "resume": nil}
		for key, value := range action {
			item[key] = value
		}
		full = append(full, item)
	}
	out, _ := json.Marshal(map[string]any{
		"observation": "I see a form", "memo": "notes after " + message, "job": "Data engineer at Acme",
		"status": status, "message": message, "actions": full,
	})
	return string(out)
}

func newTestAgent(t *testing.T, model *scriptedModel, decider Decider, cfg Config) *Agent {
	t.Helper()
	return newAgentWithScreen(t, model, decider, nil, cfg)
}

// newAgentWithScreen is an agent whose screen checks are answered by screen; nil turns them off.
func newAgentWithScreen(t *testing.T, model *scriptedModel, decider Decider, screen Screen, cfg Config) *Agent {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, applicant.ProfileFile), []byte(`{"name":"Ada Lovelace","email":"ada@example.com"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"data/Ada.pdf", "backend/Ada.pdf"} {
		path := filepath.Join(dir, applicant.ResumeDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("pdf"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	var newScreen func(string) Screen
	if screen != nil {
		newScreen = func(string) Screen { return screen }
	}
	return New(cfg, applicant.NewStore(dir),
		func(string) llm.Model { return model },
		func(string) Decider { return decider },
		newScreen)
}

// startOnForm opens a run and marks the session as already on the application form, so tests
// that count screen-check calls are not preceded by the navigation gate.
func startOnForm(t *testing.T, a *Agent) string {
	t.Helper()
	id := start(t, a)
	s, ok := a.sessions.get(id)
	if !ok {
		t.Fatal("no session")
	}
	s.mu.Lock()
	s.formReady = true
	s.mu.Unlock()
	return id
}

func start(t *testing.T, a *Agent) string {
	t.Helper()
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply"})
	if err != nil {
		t.Fatal(err)
	}
	return started.SessionID
}

func TestStartNeedsAKeyAndTheApplicant(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	if _, err := a.Start(context.Background(), "  ", applicant.Auth{}, Start{}); !errors.Is(err, llm.ErrNoKey) {
		t.Fatalf("no key: %v", err)
	}
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if err != nil {
		t.Fatal(err)
	}
	if len(started.Resumes) != 2 || started.Resumes[0].ID != "backend/Ada.pdf" {
		t.Fatalf("resumes = %+v", started.Resumes)
	}

	empty := New(DefaultConfig(), applicant.NewStore(t.TempDir()), func(string) llm.Model { return nil }, func(string) Decider { return nil }, nil)
	if _, err := empty.Start(context.Background(), "key", applicant.Auth{}, Start{}); !errors.Is(err, applicant.ErrNoProfile) {
		t.Fatalf("no profile: %v", err)
	}
}

func TestStepSendsTheScreenshotProfileAndMemory(t *testing.T) {
	model := &scriptedModel{replies: []string{
		answerJSON("working", "Filling the name", map[string]any{"kind": "click", "x": 100.4, "y": 50.0}, map[string]any{"kind": "type", "text": "Ada"}),
		answerJSON("working", "Next field", map[string]any{"kind": "key", "keys": "Tab"}),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)

	first, err := a.Step(context.Background(), id, observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != StatusWorking || len(first.Actions) != 2 || first.Number != 1 {
		t.Fatalf("first = %+v", first)
	}
	if first.Actions[0].ID != "s1a1" || *first.Actions[0].X != 100 || first.Actions[1].Text != "Ada" {
		t.Fatalf("actions = %+v", first.Actions)
	}

	second, err := a.Step(context.Background(), id, observation(shot(t, 255, image.Rect(50, 40, 200, 70))))
	if err != nil {
		t.Fatal(err)
	}
	if second.Number != 2 || second.Usage.Calls != 2 {
		t.Fatalf("second = %+v", second)
	}

	req := model.requests[1]
	system := req.Messages[0]
	if system.Role != llm.RoleSystem || !strings.Contains(system.Text, "Ada Lovelace") || !strings.Contains(system.Text, "backend (pdf)") {
		t.Fatalf("system prompt lacks the applicant: %q", system.Text)
	}
	last := req.Messages[len(req.Messages)-1]
	if len(last.Images) != 1 || !strings.Contains(last.Text, "notes after Filling the name") {
		t.Fatalf("current turn = %+v", last)
	}
	if req.SchemaName != replySchemaName || len(req.Schema) == 0 {
		t.Fatalf("the model was not given the reply schema")
	}
}

func TestStepRepairsAnAnswerThatIsNotJSON(t *testing.T) {
	model := &scriptedModel{replies: []string{"I will click the button", answerJSON("working", "ok", map[string]any{"kind": "wait", "ms": 500})}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step, err := a.Step(context.Background(), start(t, a), observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if len(model.requests) != 2 || step.Actions[0].Ms != 500 {
		t.Fatalf("requests=%d step=%+v", len(model.requests), step)
	}
	repair := model.requests[1].Messages
	if !strings.Contains(repair[len(repair)-1].Text, "not accepted") {
		t.Fatalf("the model was not told why: %q", repair[len(repair)-1].Text)
	}
	if step.Usage.Calls != 1 || step.Usage.InputTokens != 200 {
		t.Fatalf("both attempts are billed: %+v", step.Usage)
	}
}

func TestStepGivesUpWhenTheModelNeverAnswersJSON(t *testing.T) {
	model := &scriptedModel{replies: []string{"nope", "still nope"}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	if _, err := a.Step(context.Background(), start(t, a), observation(shot(t, 255))); err == nil {
		t.Fatal("expected an error")
	}
}

func TestStepRefusesActionsOutsideTheScreenshot(t *testing.T) {
	model := &scriptedModel{replies: []string{answerJSON("working", "go",
		map[string]any{"kind": "click", "x": 9999.0, "y": 10.0},
		map[string]any{"kind": "type", "text": ""},
		map[string]any{"kind": "key", "keys": " "},
		map[string]any{"kind": "scroll"},
		map[string]any{"kind": "click", "x": 10.0, "y": 10.0},
	)}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step, err := a.Step(context.Background(), start(t, a), observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if len(step.Actions) != 1 || step.Actions[0].ID != "s1a5" || len(step.Dropped) != 4 {
		t.Fatalf("actions=%+v dropped=%v", step.Actions, step.Dropped)
	}
}

func TestStepCapsActionsPerStep(t *testing.T) {
	var many []map[string]any
	for i := 0; i < 9; i++ {
		many = append(many, map[string]any{"kind": "key", "keys": "Tab"})
	}
	model := &scriptedModel{replies: []string{answerJSON("working", "tabbing", many...)}}
	cfg := DefaultConfig()
	cfg.MaxActions = 4
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	step, err := a.Step(context.Background(), start(t, a), observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if len(step.Actions) != 4 || len(step.Dropped) != 5 {
		t.Fatalf("actions=%d dropped=%d", len(step.Actions), len(step.Dropped))
	}
}

func TestStepWaitsWhenWorkingWithNothingToDo(t *testing.T) {
	model := &scriptedModel{replies: []string{answerJSON("working", "thinking")}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step, err := a.Step(context.Background(), start(t, a), observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if len(step.Actions) != 1 || step.Actions[0].Kind != KindWait {
		t.Fatalf("step = %+v", step)
	}
}

func TestSecretTextIsNeverTraced(t *testing.T) {
	model := &scriptedModel{replies: []string{answerJSON("working", "password",
		map[string]any{"kind": "type", "text": "hunter2-password", "secret": true},
		map[string]any{"kind": "type", "text": "Ada"})}}
	cfg := DefaultConfig()
	cfg.TraceDir = t.TempDir()
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	step, err := a.Step(context.Background(), id, observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if step.Actions[0].Text != "hunter2-password" {
		t.Fatal("the extension still needs the real text")
	}
	raw, err := os.ReadFile(filepath.Join(cfg.TraceDir, id, "001.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "hunter2") || !strings.Contains(string(raw), "[16 secret characters]") || !strings.Contains(string(raw), "Ada") {
		t.Fatalf("trace = %s", raw)
	}
	if _, err := os.Stat(filepath.Join(cfg.TraceDir, id, "001.jpg")); err != nil {
		t.Fatalf("the screenshot was not traced: %v", err)
	}
}

func TestNonWorkingStatusEndsTheRun(t *testing.T) {
	model := &scriptedModel{replies: []string{answerJSON("need_person", "A CAPTCHA is on the page", map[string]any{"kind": "click", "x": 5.0, "y": 5.0})}}
	a := newTestAgent(t, model, &fixedDecider{}, stopsAtOnce())
	id := start(t, a)
	step, err := a.Step(context.Background(), id, observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if step.Status != StatusNeedPerson || len(step.Actions) != 0 {
		t.Fatalf("step = %+v", step)
	}
	if _, err := a.Step(context.Background(), id, observation(shot(t, 255))); !errors.Is(err, ErrSessionOver) {
		t.Fatalf("after the end: %v", err)
	}
}

func TestUnchangedScreenIsToldToTheModelThenEndsTheRun(t *testing.T) {
	var replies []string
	for i := 0; i < 8; i++ {
		replies = append(replies, answerJSON("working", "clicking", map[string]any{"kind": "click", "x": 10.0, "y": 10.0}))
	}
	model := &scriptedModel{replies: replies}
	cfg := DefaultConfig()
	cfg.MaxStale = 3
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	same := observation(shot(t, 255))

	if _, err := a.Step(context.Background(), id, same); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Step(context.Background(), id, same); err != nil {
		t.Fatal(err)
	}
	second := model.requests[1].Messages
	if !strings.Contains(second[len(second)-1].Text, "looks the same") {
		t.Fatalf("the model was not told the screen did not change:\n%s", second[len(second)-1].Text)
	}
	if _, err := a.Step(context.Background(), id, same); err != nil {
		t.Fatal(err)
	}
	step, err := a.Step(context.Background(), id, same)
	if err != nil {
		t.Fatal(err)
	}
	if step.Status != StatusStuck || !strings.Contains(step.Message, "did not change") || len(model.requests) != 3 {
		t.Fatalf("step=%+v requests=%d", step, len(model.requests))
	}
}

func TestACaretBlinkIsNotAChange(t *testing.T) {
	a, b := shot(t, 255), shot(t, 255, image.Rect(100, 100, 102, 118))
	sa, _, _, err := signature(a)
	if err != nil {
		t.Fatal(err)
	}
	sb, _, _, _ := signature(b)
	sc, _, _, _ := signature(shot(t, 255, image.Rect(50, 40, 250, 80)))
	if !unchanged(sa, sb) {
		t.Fatal("a 2px caret counted as a change")
	}
	if unchanged(sa, sc) {
		t.Fatal("typed text did not count as a change")
	}
}

func TestRetryingAFailedCallDoesNotCountAsAStaleScreen(t *testing.T) {
	model := &scriptedModel{replies: []string{
		answerJSON("working", "one", map[string]any{"kind": "wait", "ms": 100}),
		answerJSON("working", "two", map[string]any{"kind": "wait", "ms": 100}),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	if _, err := a.Step(context.Background(), id, observation(shot(t, 255))); err != nil {
		t.Fatal(err)
	}
	model.err = errors.New("provider down")
	obs := observation(shot(t, 200))
	for i := 0; i < 5; i++ {
		if _, err := a.Step(context.Background(), id, obs); err == nil {
			t.Fatal("expected the provider error")
		}
	}
	model.err = nil
	if _, err := a.Step(context.Background(), id, obs); err != nil {
		t.Fatalf("a retry after the provider came back was refused: %v", err)
	}
	last := model.requests[len(model.requests)-1].Messages
	if strings.Contains(last[len(last)-1].Text, "looks the same") {
		t.Fatal("failed attempts were counted as an unchanged screen")
	}
}

// sameMessages is whether two requests carry the same messages, screenshots included.
func sameMessages(a, b []llm.Message) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Role != b[i].Role || a[i].Text != b[i].Text || strings.Join(a[i].Images, "") != strings.Join(b[i].Images, "") {
			return false
		}
	}
	return true
}

func runWaitSteps(t *testing.T, cfg Config, n int) *scriptedModel {
	t.Helper()
	var replies []string
	for i := 0; i < n; i++ {
		replies = append(replies, answerJSON("working", "step "+string(rune('A'+i)), map[string]any{"kind": "wait", "ms": 100}))
	}
	model := &scriptedModel{replies: replies}
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	for i := 0; i < n; i++ {
		// Each screen differs so none counts as stale.
		if _, err := a.Step(context.Background(), id, observation(shot(t, uint8(25*i)))); err != nil {
			t.Fatal(err)
		}
	}
	return model
}

func TestHistoryOnlyGrowsAtTheEndSoTheProviderCanCacheIt(t *testing.T) {
	model := runWaitSteps(t, DefaultConfig(), 8)
	for n := 1; n < len(model.requests); n++ {
		before, after := model.requests[n-1].Messages, model.requests[n].Messages
		if len(after) != len(before)+2 || !sameMessages(before, after[:len(before)]) {
			t.Fatalf("request %d does not start with request %d unchanged (%d then %d messages)", n+1, n, len(before), len(after))
		}
		if after[len(before)].Role != llm.RoleAssistant {
			t.Fatalf("request %d: the model's own answer must follow the earlier request", n+1)
		}
	}
	images := 0
	for _, message := range model.requests[7].Messages {
		images += len(message.Images)
	}
	if images != 8 {
		t.Fatalf("every screenshot is kept until the history is compacted: %d, want 8", images)
	}
}

func TestHistoryIsCompactedOnceItPassesTheBudgetThenGrowsAgain(t *testing.T) {
	cfg := DefaultConfig()
	cfg.KeepTurns, cfg.KeepImages, cfg.HistoryTokens = 4, 2, 9000
	model := runWaitSteps(t, cfg, 14)

	compactions := 0
	for n := 1; n < len(model.requests); n++ {
		before, after := model.requests[n-1].Messages, model.requests[n].Messages
		if len(after) == len(before)+2 && sameMessages(before, after[:len(before)]) {
			continue
		}
		compactions++
		images, turns, folded := 0, 0, ""
		for _, message := range after {
			images += len(message.Images)
			if message.Role == llm.RoleAssistant {
				turns++
			}
			if strings.HasPrefix(message.Text, "Earlier in this run") {
				folded = message.Text
			}
		}
		// The newest kept turns keep their screenshots, plus the current one.
		if turns > cfg.KeepTurns || images > cfg.KeepImages+1 || !strings.Contains(folded, "step 1: step A") {
			t.Fatalf("request %d: turns=%d images=%d folded=%q", n+1, turns, images, folded)
		}
	}
	if compactions < 1 || compactions > 4 {
		t.Fatalf("the history was compacted %d times in 14 steps; once the budget is passed it must stay small for several steps", compactions)
	}
}

func TestHistoryFoldsEarlyWhenOverBudget(t *testing.T) {
	var replies []string
	for i := 0; i < 5; i++ {
		replies = append(replies, answerJSON("working", "turn", map[string]any{"kind": "wait", "ms": 100}))
	}
	model := &scriptedModel{replies: replies}
	cfg := DefaultConfig()
	cfg.HistoryTokens = 1 // nothing fits: only the newest turn may stay
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	for i := 0; i < 5; i++ {
		if _, err := a.Step(context.Background(), id, observation(shot(t, uint8(40*i)))); err != nil {
			t.Fatal(err)
		}
	}
	turns := 0
	for _, message := range model.requests[4].Messages {
		if message.Role == llm.RoleAssistant {
			turns++
		}
	}
	if turns != 1 {
		t.Fatalf("turns replayed = %d, want 1", turns)
	}
}

func TestStepLimitEndsTheRun(t *testing.T) {
	model := &scriptedModel{replies: []string{
		answerJSON("working", "one", map[string]any{"kind": "wait", "ms": 100}),
		answerJSON("working", "two", map[string]any{"kind": "wait", "ms": 100}),
	}}
	cfg := DefaultConfig()
	cfg.MaxSteps = 2
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	for i := 0; i < 2; i++ {
		if _, err := a.Step(context.Background(), id, observation(shot(t, uint8(80*i)))); err != nil {
			t.Fatal(err)
		}
	}
	step, err := a.Step(context.Background(), id, observation(shot(t, 250)))
	if err != nil || step.Status != StatusStuck || !strings.Contains(step.Message, "limit of 2 steps") {
		t.Fatalf("step=%+v err=%v", step, err)
	}
}

func TestUploadChoosesAResumeWithTheDecisionModel(t *testing.T) {
	model := &scriptedModel{replies: []string{
		answerJSON("working", "uploading", map[string]any{"kind": "upload", "x": 50.0, "y": 60.0}),
		answerJSON("working", "uploading again", map[string]any{"kind": "upload", "x": 50.0, "y": 60.0}),
		answerJSON("working", "named", map[string]any{"kind": "upload", "x": 50.0, "y": 60.0, "resume": "DATA/ada.pdf"}),
	}}
	decider := &fixedDecider{choice: "resume_1"} // backend/Ada.pdf is second in the sorted list
	a := newTestAgent(t, model, decider, DefaultConfig())
	id := start(t, a)

	step, err := a.Step(context.Background(), id, observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if step.Actions[0].Resume != "data/Ada.pdf" && step.Actions[0].Resume != "backend/Ada.pdf" {
		t.Fatalf("upload = %+v", step.Actions[0])
	}
	// "backend/Ada.pdf" sorts before "data/Ada.pdf", so resume_1 is the data one.
	if step.Actions[0].Resume != "data/Ada.pdf" || step.Actions[0].FileName != "Ada.pdf" {
		t.Fatalf("Jev's choice was not used: %+v", step.Actions[0])
	}
	again, err := a.Step(context.Background(), id, observation(shot(t, 120)))
	if err != nil {
		t.Fatal(err)
	}
	if again.Actions[0].Resume != "data/Ada.pdf" || decider.calls != 1 {
		t.Fatalf("the choice was not reused: %+v calls=%d", again.Actions[0], decider.calls)
	}
	named, err := a.Step(context.Background(), id, observation(shot(t, 60)))
	if err != nil {
		t.Fatal(err)
	}
	if named.Actions[0].Resume != "data/Ada.pdf" {
		t.Fatalf("a named résumé was not matched: %+v", named.Actions[0])
	}
}

func TestUploadFallsBackToTheFirstResumeWhenTheDecisionFails(t *testing.T) {
	model := &scriptedModel{replies: []string{answerJSON("working", "uploading", map[string]any{"kind": "upload", "x": 50.0, "y": 60.0})}}
	a := newTestAgent(t, model, &fixedDecider{err: errors.New("down")}, DefaultConfig())
	step, err := a.Step(context.Background(), start(t, a), observation(shot(t, 255)))
	if err != nil {
		t.Fatal(err)
	}
	if step.Actions[0].Resume != "backend/Ada.pdf" || len(step.Dropped) != 1 || !strings.Contains(step.Dropped[0], "résumé choice failed") {
		t.Fatalf("step = %+v", step)
	}
}

func TestResumeFileNeedsALiveSession(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	if _, data, err := a.ResumeFile(context.Background(), id, "data/Ada.pdf"); err != nil || string(data) != "pdf" {
		t.Fatalf("data=%q err=%v", data, err)
	}
	if _, _, err := a.ResumeFile(context.Background(), "nope", "data/Ada.pdf"); !errors.Is(err, ErrNoSession) {
		t.Fatalf("unknown session: %v", err)
	}
	if _, _, err := a.ResumeFile(context.Background(), id, "../profile.json"); !errors.Is(err, applicant.ErrNoResume) {
		t.Fatalf("path escape: %v", err)
	}
	a.End(id)
	if _, err := a.Step(context.Background(), id, observation(shot(t, 255))); !errors.Is(err, ErrNoSession) {
		t.Fatalf("ended session: %v", err)
	}
}

func TestStepRejectsAnUnreadableObservation(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	bad := observation("not an image")
	if _, err := a.Step(context.Background(), id, bad); !errors.Is(err, ErrBadObservation) {
		t.Fatalf("bad screenshot: %v", err)
	}
	noSize := observation(shot(t, 255))
	noSize.Viewport = Viewport{}
	if _, err := a.Step(context.Background(), id, noSize); !errors.Is(err, ErrBadObservation) {
		t.Fatalf("no viewport: %v", err)
	}
}

func TestSessionsRunIndependently(t *testing.T) {
	model := &scriptedModel{}
	for i := 0; i < 20; i++ {
		model.replies = append(model.replies, answerJSON("working", "go", map[string]any{"kind": "wait", "ms": 100}))
	}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		id := start(t, a)
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := a.Step(context.Background(), id, observation(shot(t, 255)))
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if a.Sessions() != 20 {
		t.Fatalf("sessions = %d", a.Sessions())
	}
}

// stackAgent is an agent whose applicant keeps one stack in two formats and a cover letter loose.
func stackAgent(t *testing.T, model *scriptedModel, decider Decider, profile string) *Agent {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, applicant.ProfileFile), []byte(profile), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"C# + React/Ada.pdf", "C# + React/Ada.docx", "Go/Ada.pdf", "Go/Ada.docx", "Cover Letter.pdf", "Cover Letter.docx"} {
		path := filepath.Join(dir, applicant.ResumeDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return New(DefaultConfig(), applicant.NewStore(dir),
		func(string) llm.Model { return model }, func(string) Decider { return decider }, nil)
}

func uploadStepUnused(t *testing.T, a *Agent, id string, resume any) Action {
	t.Helper()
	step, err := a.Step(context.Background(), id, observation(shot(t, uint8(len(id)*7))))
	if err != nil {
		t.Fatal(err)
	}
	if len(step.Actions) != 1 {
		t.Fatalf("step = %+v", step)
	}
	_ = resume
	return step.Actions[0]
}

func TestAStackIsChosenOnceAndSentAsAPDFUnlessAnotherFormatIsNamed(t *testing.T) {
	up := func(resume any) string {
		return answerJSON("working", "up", map[string]any{"kind": "upload", "x": 5.0, "y": 5.0, "resume": resume})
	}
	model := &scriptedModel{replies: []string{up(nil), up("C# + React docx"), up("Cover Letter"), up("Cover Letter.docx"), up(nil)}}
	decider := &fixedDecider{choice: "resume_0"} // "C# + React" is the first stack
	a := stackAgent(t, model, decider, `{"name":"Ada"}`)
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if err != nil {
		t.Fatal(err)
	}
	system := ""
	_, _ = a.Step(context.Background(), started.SessionID, observation(shot(t, 10))) // the first upload
	system = model.requests[0].Messages[0].Text
	if !strings.Contains(system, "- C# + React (pdf, docx)") || !strings.Contains(system, "# Other documents") || !strings.Contains(system, "- Cover Letter (pdf)") {
		t.Fatalf("catalog = %q", system)
	}
	wants := []string{"C# + React/Ada.docx", "Cover Letter.pdf", "Cover Letter.docx", "C# + React/Ada.pdf"}
	for i, want := range wants {
		step, err := a.Step(context.Background(), started.SessionID, observation(shot(t, uint8(40*(i+2)))))
		if err != nil {
			t.Fatal(err)
		}
		if got := step.Actions[0].Resume; got != want {
			t.Fatalf("upload %d sent %q, want %q", i+2, got, want)
		}
	}
	if decider.calls != 1 {
		t.Fatalf("the decision model was asked %d times, want once", decider.calls)
	}
}

func TestTheFirstUploadIsAPDFOfTheChosenStack(t *testing.T) {
	model := &scriptedModel{replies: []string{answerJSON("working", "up", map[string]any{"kind": "upload", "x": 5.0, "y": 5.0})}}
	a := stackAgent(t, model, &fixedDecider{choice: "resume_1"}, `{"name":"Ada"}`)
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if err != nil {
		t.Fatal(err)
	}
	step, err := a.Step(context.Background(), started.SessionID, observation(shot(t, 10)))
	if err != nil {
		t.Fatal(err)
	}
	if step.Actions[0].Resume != "Go/Ada.pdf" {
		t.Fatalf("upload = %+v", step.Actions[0])
	}
}

func TestADocumentIsNeverChosenAsAResume(t *testing.T) {
	var seen []string
	decider := deciderFunc(func(req jev.Request) (jev.Response, error) {
		for _, name := range req.Questions[resumeQuestion].Criteria {
			seen = append(seen, name)
		}
		return jev.Response{Answers: map[string]jev.Answer{resumeQuestion: {Choice: "resume_0"}}}, nil
	})
	model := &scriptedModel{replies: []string{answerJSON("working", "up", map[string]any{"kind": "upload", "x": 5.0, "y": 5.0})}}
	a := stackAgent(t, model, decider, `{"name":"Ada"}`)
	started, _ := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if _, err := a.Step(context.Background(), started.SessionID, observation(shot(t, 10))); err != nil {
		t.Fatal(err)
	}
	for _, name := range seen {
		if strings.Contains(name, "Cover Letter") {
			t.Fatalf("the cover letter was offered as a résumé: %v", seen)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("stacks offered = %v", seen)
	}
}

type deciderFunc func(jev.Request) (jev.Response, error)

func (f deciderFunc) Decide(_ context.Context, req jev.Request) (jev.Response, error) { return f(req) }

func TestThePasswordIsNeverShownToTheModelOnlyTyped(t *testing.T) {
	profile := `{"_id":{"$oid":"oid-9d1"},"accountId":"acct-7f3a","profile":{"fullName":"Ada","email":"ada@example.com","middleName":"",` +
		`"openrouterApiKey":"sk-or-v1-SECRETKEY","extensionPassword":"ext-secret","defaultAccountPassword":"Hunter2!pass"}}`
	model := &scriptedModel{replies: []string{
		answerJSON("working", "password", map[string]any{"kind": "type", "text": "{{account_password}}", "secret": true}),
		answerJSON("working", "again", map[string]any{"kind": "type", "text": "x{{account_password}}"}),
	}}
	cfg := DefaultConfig()
	cfg.TraceDir = t.TempDir()
	a := stackAgent(t, model, &fixedDecider{}, profile)
	a.trace = &tracer{dir: cfg.TraceDir}
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{})
	if err != nil {
		t.Fatal(err)
	}
	first, err := a.Step(context.Background(), started.SessionID, observation(shot(t, 10)))
	if err != nil {
		t.Fatal(err)
	}
	if first.Actions[0].Text != "Hunter2!pass" || !first.Actions[0].Secret {
		t.Fatalf("the password was not typed in the placeholder's place: %+v", first.Actions[0])
	}
	second, err := a.Step(context.Background(), started.SessionID, observation(shot(t, 200)))
	if err != nil {
		t.Fatal(err)
	}
	if second.Actions[0].Text != "xHunter2!pass" || !second.Actions[0].Secret {
		t.Fatalf("a placeholder inside text was not replaced, or not marked secret: %+v", second.Actions[0])
	}

	// Nothing the model was sent, and nothing recorded, holds a secret.
	for _, request := range model.requests {
		for _, message := range request.Messages {
			for _, secret := range []string{"Hunter2", "SECRETKEY", "ext-secret", "oid-9d1", "acct-7f3a"} {
				if strings.Contains(message.Text, secret) {
					t.Fatalf("%q reached the model in a %s message: %s", secret, message.Role, message.Text)
				}
			}
		}
	}
	if !strings.Contains(model.requests[0].Messages[0].Text, "{{account_password}}") || !strings.Contains(model.requests[0].Messages[0].Text, `"fullName": "Ada"`) {
		t.Fatal("the model was not given the profile with the password's placeholder")
	}
	files, _ := filepath.Glob(filepath.Join(cfg.TraceDir, started.SessionID, "*.json"))
	for _, file := range files {
		raw, _ := os.ReadFile(file)
		if strings.Contains(string(raw), "Hunter2") {
			t.Fatalf("a secret was traced: %s", raw)
		}
	}
}

func TestTheKeyInTheProfileIsTheLastResort(t *testing.T) {
	profile := `{"profile":{"fullName":"Ada","openrouterApiKey":"sk-from-profile"}}`
	a := stackAgent(t, &scriptedModel{}, &fixedDecider{}, profile)
	var used string
	a.newModel = func(key string) llm.Model {
		used = key
		return &scriptedModel{replies: []string{answerJSON("done", "ok")}}
	}
	started, err := a.Start(context.Background(), "", applicant.Auth{}, Start{})
	if err != nil {
		t.Fatalf("a profile with a key should start without one: %v", err)
	}
	if _, err := a.Step(context.Background(), started.SessionID, observation(shot(t, 10))); err != nil {
		t.Fatal(err)
	}
	if used != "sk-from-profile" {
		t.Fatalf("model key = %q", used)
	}
	// The server's own key wins over the profile's.
	started, _ = a.Start(context.Background(), "sk-server", applicant.Auth{}, Start{})
	_, _ = a.Step(context.Background(), started.SessionID, observation(shot(t, 10)))
	if used != "sk-server" {
		t.Fatalf("model key = %q, want the server's", used)
	}
	// And with neither there is nothing to call the model with.
	bare := stackAgent(t, &scriptedModel{}, &fixedDecider{}, `{"fullName":"Ada"}`)
	if _, err := bare.Start(context.Background(), "", applicant.Auth{}, Start{}); !errors.Is(err, llm.ErrNoKey) {
		t.Fatalf("no key anywhere: %v", err)
	}
}

func TestAScreenshotThatIsNotTheViewportSizeIsRefused(t *testing.T) {
	// A Retina capture: the image is twice the size the viewport says. The model would
	// measure in the image's pixels and every click would land at half the distance.
	a := newTestAgent(t, &scriptedModel{replies: []string{answerJSON("working", "x", map[string]any{"kind": "wait", "ms": 100})}}, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	wrong := observation(shot(t, 255))
	wrong.Viewport.Width, wrong.Viewport.Height = 640, 400
	_, err := a.Step(context.Background(), id, wrong)
	if !errors.Is(err, ErrBadObservation) || !strings.Contains(err.Error(), "1280x800") || !strings.Contains(err.Error(), "640x400") {
		t.Fatalf("err = %v", err)
	}
	// A rounding of one pixel is not a mismatch.
	rounded := observation(shot(t, 255))
	rounded.Viewport.Width = 1279
	if _, err := a.Step(context.Background(), id, rounded); err != nil {
		t.Fatalf("a one-pixel rounding was refused: %v", err)
	}
}

func TestATraceHoldsEverythingNeededToDebugARun(t *testing.T) {
	model := &scriptedModel{replies: []string{
		"not json at all",
		answerJSON("working", "Clicking Agree", map[string]any{"kind": "click", "x": 300.0, "y": 200.0}, map[string]any{"kind": "scroll", "x": 600.0, "y": 400.0, "dy": 300.0}),
	}}
	cfg := DefaultConfig()
	cfg.TraceDir = t.TempDir()
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	dir := filepath.Join(cfg.TraceDir, id)

	// The model refuses to answer in JSON twice: the step fails and the failure is recorded.
	model.replies = []string{"nope", "still nope"}
	if _, err := a.Step(context.Background(), id, observation(shot(t, 255))); err == nil {
		t.Fatal("expected the step to fail")
	}
	model.replies = []string{answerJSON("working", "Clicking Agree", map[string]any{"kind": "click", "x": 300.0, "y": 200.0}, map[string]any{"kind": "scroll", "x": 600.0, "y": 400.0, "dy": 300.0})}
	if _, err := a.Step(context.Background(), id, observation(shot(t, 255))); err != nil {
		t.Fatal(err)
	}

	read := func(name string) string {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		return string(raw)
	}
	for name, wants := range map[string][]string{
		"session.json":   {`"model": "scripted"`, `"url": "https://jobs.example/apply"`, "backend (pdf)"},
		"system.txt":     {"Ada Lovelace", "You are Acorn"},
		"001.json":       {`"error"`, "not the requested JSON", `"seq": 1`},
		"001.model.json": {`"repair": true`, `"content": "nope"`, `"content": "still nope"`, "refused:"},
		"002.json":       {`"seq": 2`, `"step": 1`, "Clicking Agree", `"kind": "click"`},
		"002.model.json": {`"latencyMs"`, `"role": "system"`, `"images": 1`, "Clicking Agree"},
		"timeline.txt":   {"001 step 1", "ERROR:", "002 step 1", "click at 300,200", "scroll 0,300"},
	} {
		text := read(name)
		for _, want := range wants {
			if !strings.Contains(text, want) {
				t.Errorf("%s lacks %q:\n%s", name, want, text)
			}
		}
	}
	// The screenshot the model saw, and the same one with the actions drawn on it.
	for _, name := range []string{"001.jpg", "002.jpg", "002.marked.jpg"} {
		if info, err := os.Stat(filepath.Join(dir, name)); err != nil || info.Size() == 0 {
			t.Errorf("%s was not written: %v", name, err)
		}
	}
	marked, err := os.ReadFile(filepath.Join(dir, "002.marked.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := os.ReadFile(filepath.Join(dir, "002.jpg"))
	if string(marked) == string(plain) {
		t.Error("the marked screenshot is the plain one: nothing was drawn")
	}
	if _, err := os.Stat(filepath.Join(dir, "001.marked.jpg")); err == nil {
		t.Error("a step with no actions has a marked screenshot")
	}
}

func TestAMarkedScreenshotShowsWhereEachActionPoints(t *testing.T) {
	x, y := 400.0, 300.0
	marked, err := markScreenshot(shot(t, 255), []Action{{Kind: KindClick, X: &x, Y: &y}})
	if err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(bytes.NewReader(marked))
	if err != nil {
		t.Fatal(err)
	}
	// A red cross arm runs through the point; the page behind it is white.
	r, g, b, _ := img.At(401, 290).RGBA()
	if !(r>>8 > 150 && g>>8 < 130 && b>>8 < 130) {
		t.Errorf("no red mark near the click point: %d %d %d", r>>8, g>>8, b>>8)
	}
	r, g, b, _ = img.At(900, 700).RGBA()
	if !(r>>8 > 240 && g>>8 > 240 && b>>8 > 240) {
		t.Errorf("the page away from the click was changed: %d %d %d", r>>8, g>>8, b>>8)
	}
}

// shotOfSize is a flat screenshot of another size than the viewport the tests use.
func shotOfSize(t *testing.T, width, height int) string {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, width, height)), nil); err != nil {
		t.Fatal(err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}
