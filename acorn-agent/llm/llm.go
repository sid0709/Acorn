// Package llm is the agent's one model client: a chat call that carries screenshots and
// answers with a JSON object that matches a schema. It speaks OpenRouter's
// OpenAI-compatible chat API, the same way the rest of Acorn reaches GPT-6 Luna.
package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Roles of a chat message.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

// Message is one chat turn: text, then any number of images (data URLs or https URLs).
type Message struct {
	Role   string
	Text   string
	Images []string
}

// Request is one model call. Schema, when set, makes the model answer with a JSON
// object of that shape.
type Request struct {
	Messages   []Message
	SchemaName string
	Schema     json.RawMessage
}

// Usage is what one call cost. Cost is USD: as OpenRouter reports it, or priced from the provider's rates, and 0 when neither.
// CachedTokens is the part of InputTokens the provider read from its prompt cache, which it
// bills at a fraction of the normal rate; CacheWriteTokens is the part it stored for later.
type Usage struct {
	InputTokens      int     `json:"inputTokens"`
	OutputTokens     int     `json:"outputTokens"`
	CachedTokens     int     `json:"cachedTokens,omitempty"`
	CacheWriteTokens int     `json:"cacheWriteTokens,omitempty"`
	Cost             float64 `json:"cost"`
}

// Add sums another call into u.
func (u *Usage) Add(other Usage) {
	u.InputTokens += other.InputTokens
	u.OutputTokens += other.OutputTokens
	u.CachedTokens += other.CachedTokens
	u.CacheWriteTokens += other.CacheWriteTokens
	u.Cost += other.Cost
}

// Response is the model's answer.
type Response struct {
	Content      string
	Model        string
	FinishReason string
	Usage        Usage
	// Latency is how long the call took, retries included; Attempts is how many requests it sent.
	Latency  time.Duration
	Attempts int
	// Provider is the API the call went to (ProviderOpenRouter or ProviderOpenAI), Served who answered it when
	// OpenRouter says (OpenAI, Azure, Amazon Bedrock), and RequestBytes how large the request was.
	Provider     string
	Served       string
	RequestBytes int
	// ConnReused is whether the request used a pooled connection, and ConnectMs how long it waited for one: a new
	// connection pays a TCP and a TLS handshake.
	ConnReused bool
	ConnectMs  int64
}

// Model is what the agent loop needs from a model. *OpenRouter is the real one.
type Model interface {
	Complete(ctx context.Context, req Request) (Response, error)
	Name() string
}

// ErrNoKey is returned when a call has no OpenRouter key.
var ErrNoKey = errors.New("Add your OpenRouter or OpenAI API key: set it on your Acorn profile, or OPENROUTER_API_KEY for the agent server")

// StatusError is a model request the provider refused or failed.
type StatusError struct {
	Status  int
	Message string
}

func (e *StatusError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("model request failed (%d): %s", e.Status, e.Message)
	}
	return fmt.Sprintf("model request failed (%d)", e.Status)
}

// Codes a caller can show the person; one per way a model call fails.
const (
	CodeNoKey       = "no_key"
	CodeInvalidKey  = "invalid_key"
	CodeNoCredits   = "no_credits"
	CodeRateLimited = "rate_limited"
	CodeBadRequest  = "bad_request"
	CodeModelError  = "model_error"
	CodeNetwork     = "network"
	CodeCancelled   = "cancelled"
)

// Code names why err happened, for a stable code beside the raw text.
func Code(err error) string {
	var status *StatusError
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrNoKey):
		return CodeNoKey
	case errors.Is(err, context.Canceled):
		return CodeCancelled
	case errors.As(err, &status):
		switch {
		case status.Status == 401 || status.Status == 403:
			return CodeInvalidKey
		case status.Status == 402:
			return CodeNoCredits
		case status.Status == 429:
			return CodeRateLimited
		case status.Status >= 400 && status.Status < 500:
			return CodeBadRequest
		}
		return CodeModelError
	}
	return CodeNetwork
}
