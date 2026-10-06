package auth

import "testing"

func TestIsStaffDomainNeedsTheWorkspaceAndTheEmailDomain(t *testing.T) {
	cases := []struct {
		email, hosted, domain string
		want                  bool
	}{
		{"robin@staff.example", "staff.example", "staff.example", true},
		{"Robin@Staff.Example", "STAFF.EXAMPLE", "@staff.example", true},
		// A personal Gmail is not managed by the Workspace, whatever it is called.
		{"robin@gmail.com", "", "staff.example", false},
		// An account the Workspace manages but on another domain alias.
		{"robin@other.com", "staff.example", "staff.example", false},
		// A look-alike domain.
		{"robin@evil-staff.example", "evil-staff.example", "staff.example", false},
		// No domain configured lets nobody in.
		{"robin@staff.example", "staff.example", "", false},
	}
	for _, tc := range cases {
		if got := IsStaffDomain(tc.email, tc.hosted, tc.domain); got != tc.want {
			t.Errorf("IsStaffDomain(%q, %q, %q) = %v", tc.email, tc.hosted, tc.domain, got)
		}
	}
}
