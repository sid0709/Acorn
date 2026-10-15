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

	"github.com/sid0709/OpenSeat/acorn-agent/agent"
	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
	"github.com/sid0709/OpenSeat/acorn-agent/llm"
	"github.com/sid0709/OpenSeat/backend-core/jev"
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
