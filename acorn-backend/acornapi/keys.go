package acornapi

import (
	"context"
	"crypto/sha256"
	"net/http"
	"sync"
	"time"

	"github.com/sid0709/acorn/acorn-backend/config"
)

// The extension shows, always, whether each model key of the profile is set and works: the OpenRouter key
// (GPT-6 Luna, which plans each page, and Jev's decisions about text) and the OpenAI key (decisions about
// screenshots, on OpenAI's own Decisions API). The keys never leave the server: it asks each provider with
// the key, the cheapest call that tells a working key from a refused one, and answers set and valid.
//
//	GET /acorn/profile/keys    {"openrouter": {"set", "valid"}, "openai": {"set", "valid"}}

const (
	// keyCheckTimeout bounds one provider's answer about a key.
	keyCheckTimeout = 10 * time.Second
	// keyCheckTTL is how long an answer about a key is kept: a key does not change between the extension's
	// reads, and the providers are not asked on every one.
	keyCheckTTL = 10 * time.Minute
)

// keyState is what the extension is told of one key. Valid is null when the provider could not be asked
// (it did not answer, or answered with something other than yes or no).
type keyState struct {
	Set   bool  `json:"set"`
	Valid *bool `json:"valid"`
}

// keyChecker asks the providers about keys and keeps their answers for keyCheckTTL, by a hash of the key.
type keyChecker struct {
	client *http.Client
	mu     sync.Mutex
	held   map[[32]byte]heldKey
}

type heldKey struct {
	valid bool
	at    time.Time
}

func newKeyChecker() *keyChecker {
	return &keyChecker{client: &http.Client{Timeout: keyCheckTimeout}, held: map[[32]byte]heldKey{}}
}

// state is what is known of a key: set or not, and whether the provider at url takes it.
func (k *keyChecker) state(ctx context.Context, url, key string) keyState {
	if key == "" {
		return keyState{}
	}
	id := sha256.Sum256([]byte(url + "\n" + key))
	k.mu.Lock()
	held, ok := k.held[id]
	k.mu.Unlock()
	if ok && time.Since(held.at) < keyCheckTTL {
		valid := held.valid
		return keyState{Set: true, Valid: &valid}
	}
	valid, known := k.ask(ctx, url, key)
	if !known {
		return keyState{Set: true}
	}
	k.mu.Lock()
	k.held[id] = heldKey{valid: valid, at: time.Now()}
	k.mu.Unlock()
	return keyState{Set: true, Valid: &valid}
}

// ask is whether the provider takes the key: 2xx yes, 401 or 403 no, anything else unknown.
func (k *keyChecker) ask(ctx context.Context, url, key string) (valid, known bool) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, false
	}
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := k.client.Do(request)
	if err != nil {
		return false, false
	}
	response.Body.Close()
	switch {
	case response.StatusCode >= 200 && response.StatusCode < 300:
		return true, true
	case response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		return false, true
	}
	return false, false
}

// profileKeys answers whether each model key of the signed-in account's profile is set and works.
func (s *Server) profileKeys(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	doc, _, err := s.profiles.Load(r.Context(), session.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the profile")
		return
	}
	var wg sync.WaitGroup
	var openRouter, openAI keyState
	wg.Add(2)
	go func() {
		defer wg.Done()
		openRouter = s.keys.state(r.Context(), config.OpenRouterKeyURL, doc.OpenrouterApiKey)
	}()
	go func() { defer wg.Done(); openAI = s.keys.state(r.Context(), config.OpenAIModelsURL, doc.OpenaiApiKey) }()
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "openrouter": openRouter, "openai": openAI})
}
