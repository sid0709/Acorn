package applicant

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Fields of Acorn's own profile export that matter to how it is read.
const (
	// wrapperField holds the profile itself when profile.json is a database export
	// ({"_id": …, "profile": {…}}).
	wrapperField = "profile"
	// APIKeyField is the OpenRouter key kept in the profile.
	APIKeyField = "openrouterApiKey"
	// OpenAIKeyField is the OpenAI key kept in the profile: the model that drives a run is called on it directly.
	OpenAIKeyField = "openaiApiKey"
	// AccountPasswordField is the password the agent uses when a site needs an account.
	AccountPasswordField = "defaultAccountPassword"
	// AccountPasswordToken stands for that password everywhere the model reads or writes:
	// the model types the token, and the server types the password.
	AccountPasswordToken = "{{account_password}}"
)

// DefaultHiddenFields never reach the model: Acorn's own keys and logins, and the
// database's bookkeeping.
var DefaultHiddenFields = []string{
	"_id", "accountId", "updatedAt", "createdAt",
	APIKeyField, OpenAIKeyField, "extensionPassword", "resumeFolderPath",
}

// secretFields are shown to the model only as a token.
var secretFields = map[string]string{AccountPasswordField: AccountPasswordToken}

// shape turns the parsed profile.json into what the model reads. A database export is
// unwrapped to its profile; hidden fields are dropped; a secret field becomes its token and
// its value is kept apart; empty values are dropped, so "not in the profile" reads as absent.
func (s *profileShaper) shape(value any) (Snapshot, error) {
	if object, ok := value.(map[string]any); ok {
		if inner, ok := object[wrapperField].(map[string]any); ok {
			value = inner
		}
	}
	out := Snapshot{Secrets: map[string]string{}}
	if object, ok := value.(map[string]any); ok {
		if key, ok := object[APIKeyField].(string); ok {
			out.APIKey = key
		}
		if key, ok := object[OpenAIKeyField].(string); ok {
			out.OpenAIKey = key
		}
	}
	cleaned := s.clean(value, out.Secrets)
	pretty, err := json.MarshalIndent(cleaned, "", "  ")
	if err != nil {
		return Snapshot{}, fmt.Errorf("format %s: %w", ProfileFile, err)
	}
	out.Profile = string(pretty)
	return out, nil
}

func (s *profileShaper) clean(value any, secrets map[string]string) any {
	switch v := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(v))
		for _, key := range keys {
			if s.hidden[key] {
				continue
			}
			if token, ok := secretFields[key]; ok {
				if text, ok := v[key].(string); ok && text != "" {
					secrets[token] = text
					out[key] = token
				}
				continue
			}
			if cleaned := s.clean(v[key], secrets); !empty(cleaned) {
				out[key] = cleaned
			}
		}
		return out
	case []any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			if cleaned := s.clean(item, secrets); !empty(cleaned) {
				out = append(out, cleaned)
			}
		}
		return out
	}
	return value
}

func empty(value any) bool {
	switch v := value.(type) {
	case nil:
		return true
	case string:
		return v == ""
	case []any:
		return len(v) == 0
	case map[string]any:
		return len(v) == 0
	}
	return false
}

// profileShaper turns a profile into what the model may read; the file store and the backend
// source share it, so a profile reads the same wherever it came from.
type profileShaper struct {
	hidden map[string]bool
}

func newShaper(hidden []string) profileShaper {
	set := map[string]bool{}
	for _, name := range append(append([]string{}, DefaultHiddenFields...), hidden...) {
		if name = strings.TrimSpace(name); name != "" {
			set[name] = true
		}
	}
	return profileShaper{hidden: set}
}
