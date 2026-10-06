package acornapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/resume"
	"github.com/sid0709/OpenSeat/backend-core/killswitch"
)

type fakeAccounts struct {
	users          map[string]account.User
	applied        []string
	googleState    string
	googleVerifier string
	googleErr      error
}

func (f *fakeAccounts) Session(_ context.Context, token string, _ time.Time) (account.Session, error) {
	if user, ok := f.users[token]; ok {
		return account.Session{User: user}, nil
	}
	return account.Session{}, account.ErrInvalidLogin
}

func (f *fakeAccounts) SignUp(context.Context, string, string, string, time.Time) (string, account.User, error) {
	return "", account.User{}, account.ErrInvalid
}
func (f *fakeAccounts) SignIn(_ context.Context, email, password string, _ time.Time) (string, account.User, error) {
	if email == "j@example.com" && password == "password1" {
		user := f.users["hunter"]
		return "hunter", user, nil
	}
	return "", account.User{}, account.ErrInvalidLogin
}
func (f *fakeAccounts) Revoke(_ context.Context, token string) error {
	delete(f.users, token)
	return nil
}
func (f *fakeAccounts) SavedJobIDs(context.Context, string) ([]string, error) { return nil, nil }
func (f *fakeAccounts) AppliedJobIDs(context.Context, string) ([]string, error) {
	return nil, nil
}
func (f *fakeAccounts) MarkApplied(_ context.Context, _ string, jobID string) error {
	if jobID == "dup" {
		return account.ErrAlreadyApplied
	}
	f.applied = append(f.applied, jobID)
	return nil
}
func (f *fakeAccounts) SaveGoogleState(_ context.Context, state, verifier string, _ time.Time) error {
	f.googleState = state
	f.googleVerifier = verifier
	return nil
}
func (f *fakeAccounts) TakeGoogleState(_ context.Context, state string, _ time.Time) (string, error) {
	if state == "" || state != f.googleState {
		return "", account.ErrGoogleState
	}
	verifier := f.googleVerifier
	f.googleState = ""
	return verifier, nil
}
func (f *fakeAccounts) GoogleSignIn(context.Context, account.GoogleIdentity, time.Time) (string, account.User, error) {
	if f.googleErr != nil {
		return "", account.User{}, f.googleErr
	}
	return "hunter", account.User{ID: "u1", Name: "Jordan Lee", Email: "j@example.com"}, nil
}

type fakeModel struct{ reply string }

func (f fakeModel) JSON(context.Context, string, string, json.RawMessage) ([]byte, error) {
	return []byte(f.reply), nil
}
func (fakeModel) Model() string { return "fake" }
func (fakeModel) Ready() bool   { return true }

func newTestServer(t *testing.T, model fakeModel) (http.Handler, *fakeAccounts) {
	t.Helper()
	accounts := &fakeAccounts{users: map[string]account.User{
		"hunter": {ID: "u1", Name: "Jordan Lee", Email: "j@example.com"},
	}}
	engine := resume.New(resume.NewMemory(), model)
	engine.RunInline()
	handler, gw := New(accounts, nil, acorn.New(model), Options{Resumes: engine})
	t.Cleanup(gw.Close)
	return handler, accounts
}

func call(handler http.Handler, method, path, body string, header http.Header, cookie string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for key, values := range header {
		req.Header[key] = values
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: DefaultSessionCookie, Value: cookie})
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func bearer(token string) http.Header { return http.Header{"Authorization": {"Bearer " + token}} }

func TestSessionFromBearerOrAcornCookie(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	cases := []struct {
		name   string
		header http.Header
		cookie string
		want   int
	}{
		{"bearer", bearer("hunter"), "", http.StatusOK},
		{"acorn cookie", nil, "hunter", http.StatusOK},
		{"bearer wins over a stale cookie", bearer("hunter"), "stale", http.StatusOK},
		{"no credentials", nil, "", http.StatusUnauthorized},
		{"unknown token", bearer("nope"), "", http.StatusUnauthorized},
	}
	for _, c := range cases {
		if got := call(handler, "GET", "/acorn/auth/me", "", c.header, c.cookie).Code; got != c.want {
			t.Errorf("%s: status %d, want %d", c.name, got, c.want)
		}
	}
}

func TestMeReturnsAcornAccount(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	var body struct {
		Session map[string]string `json:"session"`
	}
	rec := call(handler, "GET", "/acorn/auth/me", "", bearer("hunter"), "")
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Session["accountId"] != "u1" || body.Session["applierName"] != "Jordan Lee" || body.Session["username"] != "j@example.com" {
		t.Fatalf("session = %v", body.Session)
	}
}

func TestHealthNeedsNoSession(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	rec := call(handler, "GET", "/acorn/health", "", nil, "")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Fatalf("health = %d %s", rec.Code, rec.Body)
	}
}

func TestResumeGenerateLibraryAndHistory(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{reply: `{"summary":"Built hiring tools.","skills":[{"category":"Go","items":["HTTP"]}],"experiences":[{"company":"Acorn","title":"Engineer","bullets":["Shipped the API"]}]}`})
	rec := call(handler, "POST", "/acorn/custom/generate", `{"jobDescription":"Build hiring tools in Go"}`, bearer("hunter"), "")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("generate: %d %s", rec.Code, rec.Body)
	}
	var started struct {
		InputID string `json:"inputId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil || started.InputID == "" {
		t.Fatalf("enqueue: %s", rec.Body)
	}
	polled := call(handler, "GET", "/acorn/custom/generate/"+started.InputID, "", bearer("hunter"), "")
	var done struct {
		Status       string `json:"status"`
		GenerationID string `json:"generationId"`
		ResumeID     string `json:"resumeId"`
	}
	if err := json.Unmarshal(polled.Body.Bytes(), &done); err != nil {
		t.Fatal(err)
	}
	if done.Status != "completed" || done.GenerationID == "" || done.ResumeID == "" {
		t.Fatalf("poll = %s", polled.Body)
	}
	file := call(handler, "GET", "/acorn/custom/resumes/"+done.GenerationID, "", bearer("hunter"), "")
	if file.Code != http.StatusOK || !strings.Contains(file.Body.String(), `"base64"`) {
		t.Fatalf("file = %d %s", file.Code, file.Body)
	}
	preview := call(handler, "GET", "/acorn/custom/resumes/"+done.GenerationID+"/preview", "", bearer("hunter"), "")
	if preview.Code != http.StatusOK || !strings.Contains(preview.Body.String(), "Built hiring tools") {
		t.Fatalf("preview = %d %s", preview.Code, preview.Body)
	}
	history := call(handler, "GET", "/acorn/resume/generations?search=hiring&searchIn=resume&includeFacets=1", "", bearer("hunter"), "")
	if history.Code != http.StatusOK || !strings.Contains(history.Body.String(), `"total":1`) {
		t.Fatalf("history = %d %s", history.Code, history.Body)
	}
	jdOnly := call(handler, "GET", "/acorn/resume/generations?search=nope&searchIn=jd", "", bearer("hunter"), "")
	if !strings.Contains(jdOnly.Body.String(), `"total":0`) {
		t.Fatalf("jd search = %s", jdOnly.Body)
	}
	recommend := call(handler, "POST", "/acorn/custom/recommend", `{"jobDescription":"Need a Go HTTP engineer"}`, bearer("hunter"), "")
	if recommend.Code != http.StatusOK || !strings.Contains(recommend.Body.String(), done.ResumeID) {
		t.Fatalf("recommend = %d %s", recommend.Code, recommend.Body)
	}
	if got := call(handler, "GET", "/acorn/jobs/missing/recommended-resume", "", bearer("hunter"), ""); got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"resumeId":null`) {
		t.Fatalf("empty job resume = %d %s", got.Code, got.Body)
	}
	if got := call(handler, "POST", "/acorn/custom/generate", `{}`, bearer("hunter"), ""); got.Code != http.StatusBadRequest {
		t.Fatalf("missing jd = %d", got.Code)
	}
}

func TestAnalyzeUsesProfileAndNeverReturnsResumeGate(t *testing.T) {
	plan := `{"goal":"g","actions":[],"forbidden_actions":[],"validation":{"required_element_indexes":[],"stop_before_submit":true},"unresolved_items":[]}`
	handler, _ := newTestServer(t, fakeModel{reply: plan})
	rec := call(handler, "POST", "/acorn/ai-analyze", `{"pureTree":"input[1]","page":{"url":"https://x"}}`, bearer("hunter"), "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("body = %s", rec.Body)
	}
	if got := call(handler, "POST", "/acorn/ai-analyze", `{"pureTree":""}`, bearer("hunter"), "").Code; got != http.StatusBadRequest {
		t.Errorf("empty tree status %d, want 400", got)
	}
}

func TestMatchOptionFailureIsData(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{reply: "not json"})
	rec := call(handler, "POST", "/acorn/match-option", `{"intendedValue":"No","options":["Yes","No"]}`, bearer("hunter"), "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":false`) {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if got := call(handler, "POST", "/acorn/match-option", `{"intendedValue":"","options":[]}`, bearer("hunter"), "").Code; got != http.StatusBadRequest {
		t.Errorf("missing fields status %d, want 400", got)
	}
}

func TestSignInReturnsTheAccount(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	rec := call(handler, "POST", "/acorn/auth/signin", `{"email":"j@example.com","password":"password1"}`, nil, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"token":"hunter"`) {
		t.Fatalf("signin = %d %s", rec.Code, rec.Body)
	}
	if rec := call(handler, "POST", "/acorn/auth/signin", `{"email":"j@example.com","password":"nope"}`, nil, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad password = %d", rec.Code)
	}
}

func TestMarkApplied(t *testing.T) {
	handler, accounts := newTestServer(t, fakeModel{})
	if rec := call(handler, "POST", "/acorn/jobs/j1/mark-applied", "", bearer("hunter"), ""); rec.Code != http.StatusOK {
		t.Fatalf("mark applied: %d %s", rec.Code, rec.Body)
	}
	if len(accounts.applied) != 1 || accounts.applied[0] != "j1" {
		t.Fatalf("applied = %v", accounts.applied)
	}
	if rec := call(handler, "POST", "/acorn/jobs/dup/mark-applied", "", bearer("hunter"), ""); rec.Code != http.StatusOK {
		t.Fatalf("already applied should still succeed: %d", rec.Code)
	}
}

func TestAcornAIKillSwitch(t *testing.T) {
	accounts := &fakeAccounts{users: map[string]account.User{
		"hunter": {ID: "u1", Name: "Jordan Lee", Email: "j@example.com"},
	}}
	handler, gw := New(accounts, nil, acorn.New(fakeModel{reply: `{"goal":"g"}`}), Options{
		KillSwitches: killswitch.NewMemory(killswitch.Defaults{killswitch.AcornAI: false}),
	})
	t.Cleanup(gw.Close)
	rec := call(handler, "POST", "/acorn/ai-analyze", `{"pureTree":"input[1]"}`, bearer("hunter"), "")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "Acorn AI") {
		t.Fatalf("killed AI = %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(handler, "GET", "/acorn/auth/me", "", bearer("hunter"), ""); rec.Code != http.StatusOK {
		t.Fatalf("auth should stay up: %d", rec.Code)
	}
}

func TestProfileSaveFillAndAnalyze(t *testing.T) {
	var prompt string
	model := captureModel{fakeModel: fakeModel{reply: `{"goal":"g","actions":[],"forbidden_actions":[],"validation":{"required_element_indexes":[],"stop_before_submit":true},"unresolved_items":[]}`}, prompt: &prompt}
	accounts := &fakeAccounts{users: map[string]account.User{
		"hunter": {ID: "u1", Name: "Jordan Lee", Email: "j@example.com"},
	}}
	handler, gw := New(accounts, nil, acorn.New(model), Options{})
	t.Cleanup(gw.Close)

	if rec := call(handler, "GET", "/acorn/profile", "", bearer("hunter"), ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"stored":false`) {
		t.Fatalf("empty profile = %d %s", rec.Code, rec.Body)
	}
	saved := call(handler, "PUT", "/acorn/profile", `{"fullName":"Jordan Lee","email":"j@example.com","phone":"(415) 555-0148","visaSponsorship":"No","timeline":[]}`, bearer("hunter"), "")
	if saved.Code != http.StatusOK || !strings.Contains(saved.Body.String(), "(415) 555-0148") {
		t.Fatalf("save = %d %s", saved.Code, saved.Body)
	}
	resumeText := "Jordan Avery Lee\njordan@example.com\n(415) 555-0199\nhttps://www.linkedin.com/in/jordan\n\nExperience\nNorthwind\nSenior Software Engineer\nJan 2022 - Present\nBuilt hiring tools for applicants.\n"
	body, err := json.Marshal(map[string]any{"text": resumeText, "profile": map[string]string{"visaSponsorship": "No", "email": "j@example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	filled := call(handler, "POST", "/acorn/profile/from-resume", string(body), bearer("hunter"), "")
	if filled.Code != http.StatusOK || !strings.Contains(filled.Body.String(), "jordan@example.com") || !strings.Contains(filled.Body.String(), `"visaSponsorship":"No"`) {
		t.Fatalf("fill = %d %s", filled.Code, filled.Body)
	}
	if rec := call(handler, "POST", "/acorn/ai-analyze", `{"pureTree":"input[1]"}`, bearer("hunter"), ""); rec.Code != http.StatusOK {
		t.Fatalf("analyze = %d %s", rec.Code, rec.Body)
	}
	if !strings.Contains(prompt, "jordan@example.com") || strings.Contains(prompt, "openaiApiKey") {
		t.Fatalf("planner prompt = %s", prompt)
	}
}

type captureModel struct {
	fakeModel
	prompt *string
}

func (c captureModel) JSON(_ context.Context, _, user string, _ json.RawMessage) ([]byte, error) {
	if c.prompt != nil {
		*c.prompt = user
	}
	return []byte(c.reply), nil
}

func TestSignOutRevokesTheAcornSession(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	if rec := call(handler, "POST", "/acorn/auth/signout", "", bearer("hunter"), ""); rec.Code != http.StatusOK {
		t.Fatalf("signout: %d", rec.Code)
	}
	if rec := call(handler, "GET", "/acorn/auth/me", "", bearer("hunter"), ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("signed-out session = %d, want 401", rec.Code)
	}
}
