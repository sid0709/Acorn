// Package jev calls TypeSafe Jev, a structured decision model, through OpenRouter's
// Decisions API. Jev reads a state and typed questions and answers each question
// with a choice and its probabilities; it never generates text.
package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/config"
	"github.com/sid0709/OpenSeat/backend-core/llmhttp"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	requestTimeout = 30 * time.Second
	maxAttempts    = 3
	maxResponse    = 1 << 20
	// idleConnTimeout keeps the TLS connection to OpenRouter open between decisions.
	// A new connection costs ~1s; a decision on a warm one is a few hundred ms.
	idleConnTimeout = 15 * time.Minute

	// TypeChoice picks one of the criteria keys; TypeNoul answers yes/no as P(yes).
	TypeChoice = "choice"
	TypeNoul   = "noul"

	// MaxChoiceOptions is the most criteria one choice question may list.
	MaxChoiceOptions = 255
)

// Question is one typed question about the state.
type Question struct {
	Type         string `json:"type"`
	Instructions string `json:"instructions"`
	// Criteria is map[string]string for choice (key → description) and for noul
	// ("true" / "false" → description).
	Criteria map[string]string `json:"criteria,omitempty"`
}

// Request is one decision call: a state and the questions asked about it.
type Request struct {
	State     string              `json:"state"`
	Questions map[string]Question `json:"questions"`
}

// Answer is Jev's answer to one question.
type Answer struct {
	Type          string             `json:"type"`
	Choice        string             `json:"choice,omitempty"`
	Noul          *float64           `json:"noul,omitempty"`
	Confidence    float64            `json:"confidence,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
}

// Usage is what the call cost. Jev bills input tokens only.
type Usage struct {
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	Cost         float64 `json:"cost"`
}

// Response holds one answer per question key.
type Response struct {
	Model   string            `json:"model"`
	Answers map[string]Answer `json:"answers"`
	Usage   Usage             `json:"usage"`
}

// sharedHTTP is one connection pool for every Jev client: a client is built per
// request (per account key), and a fresh pool would pay the TLS handshake each time.
var sharedHTTP = newHTTPClient()

func newHTTPClient() *http.Client {
	client := llmhttp.NewClient(requestTimeout)
	if transport, ok := client.Transport.(*http.Transport); ok {
		transport.IdleConnTimeout = idleConnTimeout
	}
	return client
}

type Client struct {
	apiKey string
	model  string
	url    string
	http   *http.Client
}

// New is a Jev client on the account's OpenRouter key. An empty key is not ready.
func New(apiKey string) *Client {
	return &Client{
		apiKey: strings.TrimSpace(apiKey),
		model:  config.JevModel,
		url:    config.OpenRouterDecisionsURL,
		http:   sharedHTTP,
	}
}

// Warm opens the shared connection to the Decisions API so the first real decision
// does not pay the TLS handshake. It needs no key and ignores the answer.
func Warm(ctx context.Context) {
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, config.OpenRouterDecisionsURL, nil)
	if err != nil {
		return
	}
	if response, err := sharedHTTP.Do(request); err == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}
}

func (c *Client) Model() string { return c.model }

// Ready reports whether the client has an API key.
func (c *Client) Ready() bool { return c != nil && c.apiKey != "" }

// Decide asks every question about the state in one call and retries transient failures.
func (c *Client) Decide(ctx context.Context, req Request) (Response, error) {
	if !c.Ready() {
		return Response{}, openai.ErrMissingOpenRouterKey
	}
	body, err := json.Marshal(struct {
		Model string `json:"model"`
		Request
	}{c.model, req})
	if err != nil {
		return Response{}, fmt.Errorf("encode jev request: %w", err)
	}

	started := time.Now()
	request := openai.StoredRequest(body)
	var last error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		attemptStarted := time.Now()
		res, status, retryAfter, rawResponse, err := c.post(ctx, body)
		usage := providerUsage(c.model, res.Usage)
		if err == nil {
			openai.LogProvider(ctx, "decision", c.model, status, attempt+1, len(body), attemptStarted, usage, nil, "", false)
			usage.Duration = time.Since(started)
			usage.Request = request
			usage.Response = openai.StoredResponse(rawResponse)
			openai.Note(ctx, usage)
			return res, nil
		}
		willRetry := attempt < maxAttempts-1 && ctx.Err() == nil && (status == 0 || llmhttp.Retryable(status))
		openai.LogProvider(ctx, "decision", c.model, status, attempt+1, len(body), attemptStarted, usage, err, retryAfter, willRetry)
		if !willRetry {
			openai.Note(ctx, openai.Usage{
				Model: c.model, Duration: time.Since(started), Request: request, Error: err.Error(),
			})
			return Response{}, err
		}
		last = err
		if err := llmhttp.Wait(ctx, llmhttp.RetryDelay(attempt, retryAfter)); err != nil {
			openai.Note(ctx, openai.Usage{
				Model: c.model, Duration: time.Since(started), Request: request, Error: err.Error(),
			})
			return Response{}, err
		}
	}
	if last != nil {
		openai.Note(ctx, openai.Usage{
			Model: c.model, Duration: time.Since(started), Request: request, Error: last.Error(),
		})
	}
	return Response{}, last
}

func providerUsage(model string, usage Usage) openai.Usage {
	return openai.Usage{
		Model:            model,
		PromptTokens:     usage.InputTokens,
		CompletionTokens: usage.OutputTokens,
		TotalTokens:      usage.InputTokens + usage.OutputTokens,
		CostNanos:        openai.NanosFromUSD(usage.Cost),
		Priced:           usage.Cost > 0,
	}
}

// post sends one attempt. A non-2xx status comes back with err set to the API's message.
func (c *Client) post(ctx context.Context, body []byte) (Response, int, string, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return Response{}, 0, "", nil, fmt.Errorf("build jev request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return Response{}, 0, "", nil, fmt.Errorf("jev request: %w", err)
	}
	defer response.Body.Close()
	retryAfter := response.Header.Get("Retry-After")
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponse))
	if err != nil {
		return Response{}, response.StatusCode, retryAfter, nil, fmt.Errorf("read jev response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Response{}, response.StatusCode, retryAfter, payload, statusError(response.StatusCode, payload)
	}
	var decoded Response
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return Response{}, response.StatusCode, retryAfter, payload, fmt.Errorf("decode jev response: %w", err)
	}
	return decoded, response.StatusCode, retryAfter, payload, nil
}

func statusError(status int, payload []byte) error {
	var body struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(payload, &body) == nil && body.Error != nil && strings.TrimSpace(body.Error.Message) != "" {
		return fmt.Errorf("jev request failed (%d): %s", status, strings.TrimSpace(body.Error.Message))
	}
	return fmt.Errorf("jev request failed (%d)", status)
}
