package config

import "testing"

func TestGmailRedirectFromSignIn(t *testing.T) {
	got := GmailRedirectFromSignIn("http://localhost:6005/auth/google/callback")
	want := "http://localhost:6005/auth/gmail/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if GmailRedirectFromSignIn("https://example.com/other") != "" {
		t.Fatal("unexpected derivation for non-standard sign-in path")
	}
}
