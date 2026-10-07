package openai

import (
	"errors"

	"github.com/sid0709/OpenSeat/backend-core/config"
)

const reasoningEffortNone = "none"

// ErrMissingOpenRouterKey is returned when a call has no key from the account profile.
var ErrMissingOpenRouterKey = errors.New("Add your OpenRouter API key in profile settings")

// OpenRouter calls OpenRouter's OpenAI-compatible chat API as GPT-6 Luna.
// Reasoning is off so the JSON object comes back in the message content.
func OpenRouter(apiKey string) *Client {
	client := New(apiKey, config.OpenRouterModel, config.OpenRouterBaseURL)
	client.missingKey = ErrMissingOpenRouterKey
	client.noReasoning = true
	return client
}
