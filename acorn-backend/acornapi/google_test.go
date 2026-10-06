package acornapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/backend-core/google"
)

func TestGoogleStartNeedsConfiguration(t *testing.T) {
	handler, _ := newTestServer(t, fakeModel{})
	rec := call(handler, http.MethodPost, "/v1/auth/google/start", "{}", nil, "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured start = %d, want 503", rec.Code)
	}
}

func TestGoogleStartReturnsConsentURL(t *testing.T) {
	accounts := &fakeAccounts{}
	handler, gw := New(accounts, nil, acorn.New(fakeModel{}), Options{
		Google:            &google.Client{ClientID: "client", ClientSecret: "secret"},
		GoogleRedirectURL: "http://localhost:6005/auth/google/callback",
	})
	t.Cleanup(gw.Close)

	rec := call(handler, http.MethodPost, "/v1/auth/google/start", "{}", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("start = %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		URL   string `json:"url"`
		State string `json:"state"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.URL, "accounts.google.com") || body.State == "" {
		t.Fatalf("start body = %+v", body)
	}
	if !strings.Contains(body.URL, "redirect_uri=http%3A%2F%2Flocalhost%3A6005%2Fauth%2Fgoogle%2Fcallback") {
		t.Fatalf("redirect missing from %s", body.URL)
	}
	if accounts.googleState != body.State || accounts.googleVerifier == "" {
		t.Fatalf("saved state %q verifier %q", accounts.googleState, accounts.googleVerifier)
	}
}

func TestExtensionGoogleStartRejectsOtherRedirects(t *testing.T) {
	accounts := &fakeAccounts{}
	handler, gw := New(accounts, nil, acorn.New(fakeModel{}), Options{
		Google:            &google.Client{ClientID: "client", ClientSecret: "secret"},
		GoogleRedirectURL: "http://localhost:6005/auth/google/callback",
	})
	t.Cleanup(gw.Close)

	rec := call(handler, http.MethodPost, "/acorn/auth/google/start", `{"redirectUri":"https://acorn.remotepairnet.net/auth/google/callback"}`, nil, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("site redirect = %d, want 400", rec.Code)
	}
}

func TestExtensionGoogleStartUsesExtensionRedirect(t *testing.T) {
	accounts := &fakeAccounts{}
	handler, gw := New(accounts, nil, acorn.New(fakeModel{}), Options{
		Google:            &google.Client{ClientID: "client", ClientSecret: "secret"},
		GoogleRedirectURL: "http://localhost:6005/auth/google/callback",
	})
	t.Cleanup(gw.Close)

	const redirect = "https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/"
	rec := call(handler, http.MethodPost, "/acorn/auth/google/start", `{"redirectUri":"`+redirect+`"}`, nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("start = %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "chromiumapp.org") {
		t.Fatalf("redirect missing from %s", rec.Body.String())
	}
	if accounts.googleRedirect != redirect {
		t.Fatalf("saved redirect %q", accounts.googleRedirect)
	}
}

type googleHTTP struct{}

func (googleHTTP) RoundTrip(req *http.Request) (*http.Response, error) {
	body := `{"sub":"sub-1","email":"j@example.com","email_verified":true,"name":"Jordan"}`
	if strings.Contains(req.URL.Path, "token") {
		body = `{"access_token":"tok","scope":"openid email profile"}`
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

func TestExtensionGoogleFinishNeedsAnAccount(t *testing.T) {
	accounts := &fakeAccounts{googleErr: account.ErrGoogleUnknown}
	handler, gw := New(accounts, nil, acorn.New(fakeModel{}), Options{
		Google: &google.Client{
			ClientID: "client", ClientSecret: "secret", HTTP: &http.Client{Transport: googleHTTP{}},
		},
		GoogleRedirectURL: "http://localhost:6005/auth/google/callback",
	})
	t.Cleanup(gw.Close)
	accounts.googleState = "state-1"
	accounts.googleVerifier = "verifier"

	rec := call(handler, http.MethodPost, "/acorn/auth/google/finish", `{"code":"abc","state":"state-1"}`, nil, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown gmail = %d %s, want 404", rec.Code, rec.Body.String())
	}
}

func TestGoogleCallbackRejectsUnknownState(t *testing.T) {
	accounts := &fakeAccounts{}
	handler, gw := New(accounts, nil, acorn.New(fakeModel{}), Options{
		Google:            &google.Client{ClientID: "client", ClientSecret: "secret"},
		GoogleRedirectURL: "http://localhost:6005/auth/google/callback",
	})
	t.Cleanup(gw.Close)

	rec := call(handler, http.MethodPost, "/v1/auth/google/callback", `{"code":"abc","state":"missing"}`, nil, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown state = %d, want 400", rec.Code)
	}
}
