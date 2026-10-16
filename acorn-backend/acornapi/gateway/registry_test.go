package gateway

import "testing"

func TestToken(t *testing.T) {
	cases := []struct {
		name   string
		auth   map[string]any
		header string
		want   string
	}{
		{"auth payload", map[string]any{"token": " abc "}, "", "abc"},
		{"auth wins over header", map[string]any{"token": "abc"}, "Bearer xyz", "abc"},
		{"bearer header", nil, "Bearer xyz", "xyz"},
		{"blank auth falls back", map[string]any{"token": "  "}, "Bearer xyz", "xyz"},
		{"nothing", nil, "", ""},
		{"not bearer", nil, "Basic abc", ""},
	}
	for _, c := range cases {
		if got := Token(c.auth, c.header); got != c.want {
			t.Errorf("%s: Token = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestRegistryIsScopedToAccount(t *testing.T) {
	r := NewRegistry()
	r.clients["a1"] = &Client{ID: "a1", AccountID: "A", Type: "extension", ConnectedAt: 2}
	r.clients["a2"] = &Client{ID: "a2", AccountID: "A", Type: "extension", ConnectedAt: 1}
	r.clients["a3"] = &Client{ID: "a3", AccountID: "A", Type: "ui-board", ConnectedAt: 3}
	r.clients["b1"] = &Client{ID: "b1", AccountID: "B", Type: "extension", ConnectedAt: 1}

	summary := r.SummaryFor("A")
	if len(summary) != 3 || summary[0].ID != "a2" {
		t.Fatalf("summary = %+v", summary)
	}
	for _, client := range summary {
		if client.AccountID != "A" {
			t.Fatalf("leaked %+v", client)
		}
	}
}
