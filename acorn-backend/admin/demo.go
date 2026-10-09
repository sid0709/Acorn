package admin

import (
	"os"
	"strings"
)

// EnvDemoMode is the process env that toggles open admin sign-in for demos.
const EnvDemoMode = "ACORN_ADMIN_DEMO"

// DemoMode toggles the default session signing secret when ACORN_ADMIN_SESSION_SECRET is unset.
// Unset env defaults to on for local dev; set ACORN_ADMIN_DEMO=off in production.
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
