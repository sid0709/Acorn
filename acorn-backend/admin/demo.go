package admin

import (
	"os"
	"strings"
)

// EnvDemoMode is the process env that toggles open admin sign-in for demos.
const EnvDemoMode = "ACORN_ADMIN_DEMO"

// DemoMode reports whether admin sign-in accepts any password for a valid email.
// Unset env defaults to on so local demos work; set ACORN_ADMIN_DEMO=off in production.
func DemoMode() bool {
	raw := strings.TrimSpace(os.Getenv(EnvDemoMode))
	if raw == "" {
		return true
	}
	switch strings.ToLower(raw) {
	case "0", "off", "false", "no", "disabled":
		return false
	default:
		return true
	}
}
