// Package decide is the agent's client for a decision model: a model that reads a state, which
// may carry a screenshot, and answers typed questions with probabilities. It never generates
// text, bills input tokens only, and answers in well under a second, so it is the cheap way to
// ask "is the screen what I expected" between the calls to the model that drives the run. It
// speaks OpenRouter's Decisions API.
package decide

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-agent/llm"
	"github.com/sid0709/OpenSeat/acorn-backend/llmhttp"
)

const (
	requestTimeout = 30 * time.Second
	maxAttempts    = 2
	maxResponse    = 1 << 20
	maxErrorText   = 300
	// idleConnTimeout keeps the TLS connection open between checks: a new one costs about a
	// second, and a check on a warm one under one.
	idleConnTimeout = 15 * time.Minute

	// TypeNoul answers a yes/no question as the probability of yes.
	TypeNoul = "noul"
	// TypeChoice picks one of the criteria keys and gives a probability for each.
	TypeChoice = "choice"

	partText  = "text"
	partImage = "image_url"
)

// Question is one typed question about the state.
type Question struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria,omitempty"`
}

// YesNo is a yes/no question: the answer is the probability that the answer is yes.
func YesNo(instructions string) Question {
	return Question{Type: TypeNoul, Instructions: instructions, Criteria: map[string]string{"true": "yes", "false": "no"}}
}

// Part is one piece of the state, text or an image (a data URL or an https URL).
type Part struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *ImageURL `json:"image_url,omitempty"`
}

// ImageURL is the image of a Part.
type ImageURL struct {
	URL string `json:"url"`
}

// Text is a text part of the state.
func Text(text string) Part { return Part{Type: partText, Text: text} }

// Image is an image part of the state.
func Image(url string) Part { return Part{Type: partImage, ImageURL: &ImageURL{URL: url}} }

// Request is one decision: the state and the questions asked about it. Every question is
// answered on its own and does not see the others.
type Request struct {
	State     []Part
	Questions map[string]Question
}

// Answer is the model's answer to one question.
type Answer struct {
	Type          string             `json:"type"`
	Noul          *float64           `json:"noul,omitempty"`
	Choice        string             `json:"choice,omitempty"`
	Confidence    float64            `json:"confidence,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
}

// Usage is what one decision cost. The model bills input tokens only.
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
	// Latency is how long the call took, retries included.
	Latency time.Duration `json:"-"`
}

// Client calls one decision model on a person's OpenRouter key.
type Client struct {
	apiKey string
	model  string
	url    string
	http   *http.Client
}

// sharedHTTP is one pool for every client: a client is built per run key, and a fresh pool
// would pay the TLS handshake on every check.
var sharedHTTP = newHTTPClient()

func newHTTPClient() *http.Client {
	client := llmhttp.NewClient(requestTimeout)
	if transport, ok := client.Transport.(*http.Transport); ok {
		transport.IdleConnTimeout = idleConnTimeout
	}
	return client
}

// New is a client for model at the Decisions API url.
func New(apiKey, model, url string) *Client {
	return &Client{apiKey: strings.TrimSpace(apiKey), model: model, url: url, http: sharedHTTP}
}

// Name is the model id.
func (c *Client) Name() string { return c.model }

// Warm opens the shared connection so the first check does not pay the handshake. It needs
// no key and ignores the answer.
func Warm(ctx context.Context, url string) {
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		return
	}
	if response, err := sharedHTTP.Do(request); err == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}
}

// Decide asks every question about the state in one call. A rate limit or a provider failure
// is retried once.
func (c *Client) Decide(ctx context.Context, req Request) (Response, error) {
	if c.apiKey == "" {
		return Response{}, llm.ErrNoKey
	}
	body, err := json.Marshal(struct {
		Model     string              `json:"model"`
		State     []Part              `json:"state"`
		Questions map[string]Question `json:"questions"`
	}{c.model, req.State, req.Questions})
	if err != nil {
		return Response{}, fmt.Errorf("encode decision request: %w", err)
	}
	started := time.Now()
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		response, retryAfter, err := c.once(ctx, body)
		if err == nil {
			response.Latency = time.Since(started)
			return response, nil
		}
		lastErr = err
		if ctx.Err() != nil || !retryable(err) || attempt == maxAttempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return Response{}, ctx.Err()
		case <-time.After(llmhttp.RetryDelay(attempt, retryAfter)):
		}
	}
	return Response{Latency: time.Since(started)}, lastErr
}

func retryable(err error) bool {
	var status *llm.StatusError
	if errors.As(err, &status) {
		return llmhttp.Retryable(status.Status)
	}
	return true
}

func (c *Client) once(ctx context.Context, body []byte) (Response, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return Response{}, "", fmt.Errorf("build decision request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return Response{}, "", fmt.Errorf("decision request: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponse))
	if err != nil {
		return Response{}, "", fmt.Errorf("read decision response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Response{}, response.Header.Get("Retry-After"), statusError(response.StatusCode, payload)
	}
	var decoded Response
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return Response{}, "", fmt.Errorf("decode decision response: %w", err)
	}
	return decoded, "", nil
}

func statusError(status int, payload []byte) error {
	var body struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	message := ""
	if json.Unmarshal(payload, &body) == nil && body.Error != nil {
		message = strings.TrimSpace(body.Error.Message)
	}
	if len(message) > maxErrorText {
		message = message[:maxErrorText] + "…"
	}
	return &llm.StatusError{Status: status, Message: message}
}
