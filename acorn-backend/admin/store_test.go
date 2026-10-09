package admin

import (
	"errors"
	"testing"
)

func TestSignInIdentity(t *testing.T) {
	cases := []struct {
		raw  string
		want string
		err  error
	}{
		{"admin", "admin", nil},
		{"staff@acorn.test", "staff@acorn.test", nil},
		{"  Admin  ", "admin", nil},
		{"", "", ErrInvalidLogin},
		{"   ", "", ErrInvalidLogin},
	}
	for _, tc := range cases {
		got, err := signInIdentity(tc.raw)
		if !errors.Is(err, tc.err) {
			t.Fatalf("%q: err = %v, want %v", tc.raw, err, tc.err)
		}
		if got != tc.want {
			t.Fatalf("%q: identity = %q, want %q", tc.raw, got, tc.want)
		}
	}
}
