package killswitch

import (
	"strings"
	"time"
)

// Name is one feature staff can turn off without a deploy.
type Name string

const (
	// AcornAI is Acorn's model-backed routes.
	AcornAI Name = "acorn_ai"
)

const (
	envAcornAI         = "KILLSWITCH_ACORN_AI"
	envCacheMS         = "KILLSWITCH_CACHE_MS"
	sourceEnv          = "env"
	sourceOverride     = "override"
	collectionName     = "kill_switches"
	auditCollection    = "admin_audit"
	auditSubject       = "kill_switch"
	auditActionEnable  = "kill_switch.enable"
	auditActionDisable = "kill_switch.disable"
	maxNoteLength      = 1000
)

// DefaultCache is how long a process keeps Mongo overrides before re-reading.
const DefaultCache = 5 * time.Second

// Names is every switch, in the order staff APIs list them.
var Names = []Name{AcornAI}

var envKeys = map[Name]string{
	AcornAI: envAcornAI,
}

var disabledMessages = map[Name]string{
	AcornAI: "Acorn AI is temporarily unavailable.",
}

// Known reports whether name is one of the launch kill switches.
func Known(name Name) bool {
	_, ok := envKeys[name]
	return ok
}

// Message is the 503 body when name is off.
func Message(name Name) string {
	if text, ok := disabledMessages[name]; ok {
		return text
	}
	return "This feature is temporarily unavailable."
}

func parseEnabled(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "off", "false", "0", "no", "disabled":
		return false
	default:
		return true
	}
}
