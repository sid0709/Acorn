package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/agent"
	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
	"github.com/sid0709/acorn/acorn-backend/jev"
)

type fakeModel struct {
	content string
	err     error
	keys    *[]string
}

func (m fakeModel) Name() string { return "fake" }
func (m fakeModel) Complete(context.Context, llm.Request) (llm.Response, error) {
	if m.err != nil {
		return llm.Response{}, m.err
	}
	return llm.Response{Content: m.content}, nil
}

type noDecider struct{}

func (noDecider) Decide(context.Context, jev.Request) (jev.Response, error) {
	return jev.Response{}, nil
}

const workingReply = `{"observation":"a form","memo":"m","job":"","status":"working","message":"Typing","actions":[{"kind":"click","x":10,"y":10,"text":null,"secret":null,"keys":null,"dx":null,"dy":null,"ms":null,"resume":null}]}`

func newServer(t *testing.T, model fakeModel, defaultKey string) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, applicant.ProfileFile), []byte(`{"name":"Ada"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	resumes := filepath.Join(dir, applicant.ResumeDir)
	if err := os.MkdirAll(resumes, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resumes, "Ada.pdf"), []byte("%PDF-fake"), 0o600); err != nil {
		t.Fatal(err)
	}
	a := agent.New(agent.DefaultConfig(), applicant.NewStore(dir),
		func(string) llm.Model { return model }, func(string) agent.Decider { return noDecider{} }, nil)
	server := New(a, Options{DefaultKey: defaultKey, ModelName: "fake", MaxModelCalls: 2})
	ts := httptest.NewServer(server.Handler())
	t.Cleanup(ts.Close)
	return server, ts
}

func screenshot(t *testing.T) string {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, 200, 100)), nil); err != nil {
		t.Fatal(err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func send(t *testing.T, method, url string, body any, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	request, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var out bytes.Buffer
	_, _ = out.ReadFrom(response.Body)
	return response, out.Bytes()
}

func TestARunFromStartToEnd(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")

	response, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example", Title: "Apply"}, nil)
	if response.StatusCode != 200 {
		t.Fatalf("start = %d %s", response.StatusCode, body)
	}
	var started agent.Started
	if err := json.Unmarshal(body, &started); err != nil || started.SessionID == "" || len(started.Resumes) != 1 {
		t.Fatalf("started = %+v %v", started, err)
	}

	obs := agent.Observation{Screenshot: screenshot(t), URL: "https://jobs.example", Viewport: agent.Viewport{Width: 200, Height: 100}}
	response, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+started.SessionID+"/step", obs, nil)
	if response.StatusCode != 200 {
		t.Fatalf("step = %d %s", response.StatusCode, body)
	}
	var step agent.Step
	if err := json.Unmarshal(body, &step); err != nil || step.Status != agent.StatusWorking || len(step.Actions) != 1 || step.Actions[0].Kind != agent.KindClick {
		t.Fatalf("step = %+v %v", step, err)
	}

	response, body = send(t, http.MethodGet, ts.URL+BasePath+"/sessions/"+started.SessionID+"/resume?id=Ada.pdf", nil, nil)
	if response.StatusCode != 200 || string(body) != "%PDF-fake" || response.Header.Get("X-File-Name") != "Ada.pdf" || response.Header.Get("Content-Type") != "application/pdf" {
		t.Fatalf("resume = %d %q %v", response.StatusCode, body, response.Header)
	}

	if response, _ = send(t, http.MethodDelete, ts.URL+BasePath+"/sessions/"+started.SessionID, nil, nil); response.StatusCode != http.StatusNoContent {
		t.Fatalf("end = %d", response.StatusCode)
	}
	response, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+started.SessionID+"/step", obs, nil)
	if response.StatusCode != http.StatusNotFound || !strings.Contains(string(body), `"no_session"`) {
		t.Fatalf("step after end = %d %s", response.StatusCode, body)
	}
}

func TestStartWithoutAnyKeyIsRefusedWithACode(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "")
	response, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{}, nil)
	if response.StatusCode != http.StatusUnauthorized || !strings.Contains(string(body), `"no_key"`) {
		t.Fatalf("start = %d %s", response.StatusCode, body)
	}
	// A key the extension brings is enough.
	response, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{}, map[string]string{KeyHeader: "sk-from-extension"})
	if response.StatusCode != 200 {
		t.Fatalf("start with a key = %d %s", response.StatusCode, body)
	}
}

func TestModelFailuresKeepTheirCode(t *testing.T) {
	cases := map[int]string{402: "no_credits", 429: "rate_limited", 401: "invalid_key", 503: "model_error"}
	for status, code := range cases {
		_, ts := newServer(t, fakeModel{err: &llm.StatusError{Status: status, Message: "provider said so"}}, "k")
		_, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{}, nil)
		var started agent.Started
		_ = json.Unmarshal(body, &started)
		obs := agent.Observation{Screenshot: screenshot(t), Viewport: agent.Viewport{Width: 200, Height: 100}}
		response, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+started.SessionID+"/step", obs, nil)
		want := map[int]int{402: 402, 429: 429, 401: 401, 503: 502}[status]
		if response.StatusCode != want || !strings.Contains(string(body), `"`+code+`"`) {
			t.Errorf("provider %d -> %d %s, want %d %s", status, response.StatusCode, body, want, code)
		}
	}
}

func TestBadBodiesAndObservations(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "k")
	_, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{}, nil)
	var started agent.Started
	_ = json.Unmarshal(body, &started)

	request, _ := http.NewRequest(http.MethodPost, ts.URL+BasePath+"/sessions/"+started.SessionID+"/step", strings.NewReader("{not json"))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad json = %d", response.StatusCode)
	}

	response, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+started.SessionID+"/step", agent.Observation{Screenshot: "nope", Viewport: agent.Viewport{Width: 1, Height: 1}}, nil)
	if response.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "bad_observation") {
		t.Fatalf("bad screenshot = %d %s", response.StatusCode, body)
	}

	response, body = send(t, http.MethodGet, ts.URL+BasePath+"/sessions/"+started.SessionID+"/resume?id=../profile.json", nil, nil)
	if response.StatusCode != http.StatusNotFound || !strings.Contains(string(body), "no_resume") {
		t.Fatalf("path escape = %d %s", response.StatusCode, body)
	}
}

func TestMissingProfileIsAClearError(t *testing.T) {
	a := agent.New(agent.DefaultConfig(), applicant.NewStore(t.TempDir()),
		func(string) llm.Model { return fakeModel{} }, func(string) agent.Decider { return noDecider{} }, nil)
	ts := httptest.NewServer(New(a, Options{DefaultKey: "k"}).Handler())
	defer ts.Close()
	response, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{}, nil)
	if response.StatusCode != http.StatusUnprocessableEntity || !strings.Contains(string(body), "profile.json") || !strings.Contains(string(body), "no_profile") {
		t.Fatalf("start = %d %s", response.StatusCode, body)
	}
}

func TestCORSAllowsTheExtensionAndConfiguredOriginsOnly(t *testing.T) {
	a := agent.New(agent.DefaultConfig(), applicant.NewStore(t.TempDir()),
		func(string) llm.Model { return fakeModel{} }, func(string) agent.Decider { return noDecider{} }, nil)
	ts := httptest.NewServer(New(a, Options{Origins: []string{"http://localhost:3000"}}).Handler())
	defer ts.Close()

	for origin, want := range map[string]string{
		"chrome-extension://abcdef": "chrome-extension://abcdef",
		"http://localhost:3000":     "http://localhost:3000",
		"https://evil.example":      "",
	} {
		response, _ := send(t, http.MethodOptions, ts.URL+BasePath+"/sessions", nil, map[string]string{"Origin": origin})
		if response.StatusCode != http.StatusNoContent || response.Header.Get("Access-Control-Allow-Origin") != want {
			t.Errorf("origin %s -> %d %q, want %q", origin, response.StatusCode, response.Header.Get("Access-Control-Allow-Origin"), want)
		}
	}
}

func TestHealthReportsWithoutLeakingTheKey(t *testing.T) {
	_, ts := newServer(t, fakeModel{}, "super-secret-key")
	response, body := send(t, http.MethodGet, ts.URL+BasePath+"/health", nil, nil)
	if response.StatusCode != 200 || strings.Contains(string(body), "super-secret-key") || !strings.Contains(string(body), `"hasKey":true`) {
		t.Fatalf("health = %d %s", response.StatusCode, body)
	}
}

func TestEveryAnswerSaysHowLongTheServerTookAndLetsTheExtensionReadIt(t *testing.T) {
	_, ts := newServer(t, fakeModel{}, "k")
	response, _ := send(t, http.MethodGet, ts.URL+BasePath+"/health", nil, nil)
	if got := response.Header.Get("Server-Timing"); !strings.HasPrefix(got, "handler;dur=") {
		t.Fatalf("Server-Timing = %q", got)
	}
	if response.Header.Get("Access-Control-Expose-Headers") != "Server-Timing" {
		t.Fatalf("the extension cannot read the timing: %v", response.Header)
	}
}

func TestVetAnswersForARunAndRefusesAnUnknownOne(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")
	_, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example"}, nil)
	var started agent.Started
	if err := json.Unmarshal(body, &started); err != nil {
		t.Fatal(err)
	}
	vet := func(id string, target agent.VetTarget) (int, agent.VetVerdict) {
		response, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+id+"/vet", target, nil)
		var verdict agent.VetVerdict
		_ = json.Unmarshal(body, &verdict)
		return response.StatusCode, verdict
	}
	// The stand-in decision model gives no answer, so only a control in a file component is refused.
	if status, verdict := vet(started.SessionID, agent.VetTarget{Kind: agent.VetControl, Tag: "button", Text: "Attach", InFileComponent: true}); status != 200 || !verdict.Blocked {
		t.Fatalf("file component = %d %+v", status, verdict)
	}
	if status, verdict := vet(started.SessionID, agent.VetTarget{Kind: agent.VetControl, Tag: "button", Text: "Next"}); status != 200 || verdict.Blocked {
		t.Fatalf("plain control = %d %+v", status, verdict)
	}
	if status, _ := vet("nope", agent.VetTarget{Kind: agent.VetControl}); status != http.StatusNotFound {
		t.Fatalf("unknown run = %d", status)
	}
}

func TestARunsMemoryComesBackAndSeedsANewRun(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")
	seed := agent.Memory{Memo: "on the work history step", Job: "Backend engineer", JD: "We need a Go developer.", Resume: "Go", FormReady: true}
	_, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example", Memory: &seed}, nil)
	var started agent.Started
	if err := json.Unmarshal(body, &started); err != nil {
		t.Fatal(err)
	}
	response, body := send(t, http.MethodGet, ts.URL+BasePath+"/sessions/"+started.SessionID+"/memory", nil, nil)
	var got agent.Memory
	if err := json.Unmarshal(body, &got); err != nil || response.StatusCode != 200 || got != seed {
		t.Fatalf("memory = %d %+v %v", response.StatusCode, got, err)
	}
	if response, _ := send(t, http.MethodGet, ts.URL+BasePath+"/sessions/nope/memory", nil, nil); response.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown run = %d", response.StatusCode)
	}
}

// tokenSource is an applicant that lives behind a sign-in: it knows one session token.
type tokenSource struct{ asked []string }

func (t *tokenSource) Kind() string { return "backend" }

func (t *tokenSource) SnapshotFor(_ context.Context, auth applicant.Auth) (applicant.Snapshot, error) {
	t.asked = append(t.asked, auth.Token)
	switch auth.Token {
	case "":
		return applicant.Snapshot{}, applicant.ErrSignedOut
	case "down":
		return applicant.Snapshot{}, applicant.ErrBackend
	case "no-profile":
		return applicant.Snapshot{}, applicant.ErrNoProfile
	}
	return applicant.Snapshot{Profile: `{"fullName":"Ada"}`, APIKey: "sk-theirs"}, nil
}

func (t *tokenSource) ResumeFor(context.Context, applicant.Auth, string) (applicant.Resume, []byte, error) {
	return applicant.Resume{}, nil, applicant.ErrNoResume
}

func TestTheStartOfARunCarriesThePersonsSessionToTheSource(t *testing.T) {
	source := &tokenSource{}
	a := agent.New(agent.DefaultConfig(), source,
		func(string) llm.Model { return fakeModel{} }, func(string) agent.Decider { return noDecider{} }, nil)
	ts := httptest.NewServer(New(a, Options{Source: source.Kind()}).Handler())
	defer ts.Close()

	cases := []struct {
		name    string
		header  map[string]string
		status  int
		code    string
		token   string
		message string
	}{
		{"a session", map[string]string{"Authorization": "Bearer abc123"}, 200, "", "abc123", ""},
		{"a lower-case scheme", map[string]string{"Authorization": "bearer abc123"}, 200, "", "abc123", ""},
		{"no session", nil, 401, "signed_out", "", "sign in to Acorn"},
		{"something else than a bearer token", map[string]string{"Authorization": "Basic Zm9vOmJhcg=="}, 401, "signed_out", "", ""},
		{"a backend that is down", map[string]string{"Authorization": "Bearer down"}, 502, "backend_unreachable", "down", ""},
		{"a profile that was never saved", map[string]string{"Authorization": "Bearer no-profile"}, 422, "no_profile", "no-profile", ""},
	}
	for _, tc := range cases {
		response, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example"}, tc.header)
		if response.StatusCode != tc.status || (tc.code != "" && !strings.Contains(string(body), `"`+tc.code+`"`)) {
			t.Fatalf("%s: %d %s", tc.name, response.StatusCode, body)
		}
		if tc.message != "" && !strings.Contains(string(body), tc.message) {
			t.Fatalf("%s: the person is not told %q: %s", tc.name, tc.message, body)
		}
		if got := source.asked[len(source.asked)-1]; got != tc.token {
			t.Fatalf("%s: the source was asked with %q, want %q", tc.name, got, tc.token)
		}
	}
}

func TestThePreflightAllowsTheAuthorizationHeaderForTheExtension(t *testing.T) {
	source := &tokenSource{}
	a := agent.New(agent.DefaultConfig(), source,
		func(string) llm.Model { return fakeModel{} }, func(string) agent.Decider { return noDecider{} }, nil)
	ts := httptest.NewServer(New(a, Options{}).Handler())
	defer ts.Close()
	response, _ := send(t, http.MethodOptions, ts.URL+BasePath+"/sessions", nil, map[string]string{"Origin": "chrome-extension://abc"})
	if allowed := response.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(allowed, "Authorization") {
		t.Fatalf("allowed headers = %q", allowed)
	}
}

func TestHealthSaysWhereTheApplicantComesFrom(t *testing.T) {
	a := agent.New(agent.DefaultConfig(), &tokenSource{},
		func(string) llm.Model { return fakeModel{} }, func(string) agent.Decider { return noDecider{} }, nil)
	ts := httptest.NewServer(New(a, Options{Source: "backend"}).Handler())
	defer ts.Close()
	_, body := send(t, http.MethodGet, ts.URL+BasePath+"/health", nil, nil)
	if !strings.Contains(string(body), `"source":"backend"`) {
		t.Fatalf("health = %s", body)
	}
}

func TestAStoppedRunContinuesOverHTTP(t *testing.T) {
	stuck := `{"observation":"x","memo":"m","job":"","status":"need_person","message":"Enter the code","actions":[],"stop":{"reason":"verification","problem":"A code was emailed","action":"Enter it"}}`
	_, ts := newServer(t, fakeModel{content: stuck}, "server-key")
	_, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example"}, nil)
	var started agent.Started
	if err := json.Unmarshal(body, &started); err != nil {
		t.Fatal(err)
	}
	obs := agent.Observation{Screenshot: screenshot(t), URL: "https://jobs.example", Viewport: agent.Viewport{Width: 200, Height: 100}}
	url := ts.URL + BasePath + "/sessions/" + started.SessionID
	// The first stop is sent back to finish the page (the model is asked again); the second stands.
	for i := 0; i < 2; i++ {
		if response, body := send(t, http.MethodPost, url+"/step", obs, nil); response.StatusCode != 200 {
			t.Fatalf("step = %d %s", response.StatusCode, body)
		}
	}
	if response, body := send(t, http.MethodPost, url+"/step", obs, nil); response.StatusCode != http.StatusConflict || !strings.Contains(string(body), `"run_over"`) {
		t.Fatalf("a stopped run takes no step: %d %s", response.StatusCode, body)
	}

	response, body := send(t, http.MethodPost, url+"/continue", nil, nil)
	var continued agent.Continued
	if response.StatusCode != 200 || json.Unmarshal(body, &continued) != nil || continued.Number != 2 || continued.Usage.Calls != 2 {
		t.Fatalf("continue = %d %s", response.StatusCode, body)
	}
	if response, body := send(t, http.MethodPost, url+"/step", obs, nil); response.StatusCode != 200 {
		t.Fatalf("step after continue = %d %s", response.StatusCode, body)
	}

	send(t, http.MethodDelete, url, nil, nil)
	if response, body := send(t, http.MethodPost, url+"/continue", nil, nil); response.StatusCode != http.StatusNotFound || !strings.Contains(string(body), `"no_session"`) {
		t.Fatalf("continue after end = %d %s", response.StatusCode, body)
	}
}

func TestThePrefillRouteAnswersFieldsAndRefusesARunThatDidNotTurnItOn(t *testing.T) {
	reply := `{"fills":[{"element_index":3,"action":"fill","expected_label":"Name","expected_role":"textbox","value":"Ada"}]}`
	_, ts := newServer(t, fakeModel{content: reply}, "server-key")
	fields := agent.PrefillRequest{URL: "https://jobs.example", Title: "Apply", Tree: "form[2]\n  input[3] domId=3 type=text name=full_name"}

	_, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example", Prefill: true}, nil)
	var on agent.Started
	if err := json.Unmarshal(body, &on); err != nil {
		t.Fatal(err)
	}
	response, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+on.SessionID+"/prefill", fields, nil)
	if response.StatusCode != 200 {
		t.Fatalf("prefill = %d %s", response.StatusCode, body)
	}
	var plan agent.PrefillPlan
	if err := json.Unmarshal(body, &plan); err != nil || len(plan.Fills) != 1 || plan.Fills[0].Value != "Ada" || plan.Fills[0].Ref != 3 {
		t.Fatalf("plan = %+v %v", plan, err)
	}

	_, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example"}, nil)
	var off agent.Started
	if err := json.Unmarshal(body, &off); err != nil {
		t.Fatal(err)
	}
	response, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+off.SessionID+"/prefill", fields, nil)
	if response.StatusCode != http.StatusConflict || !strings.Contains(string(body), `"prefill_unavailable"`) {
		t.Fatalf("a run without the pass = %d %s", response.StatusCode, body)
	}

	response, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+on.SessionID+"/prefill", agent.PrefillRequest{}, nil)
	if response.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), `"bad_prefill"`) {
		t.Fatalf("an empty list = %d %s", response.StatusCode, body)
	}
}
