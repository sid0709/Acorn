package llm

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

	"github.com/sid0709/acorn/acorn-backend/llmhttp"
)

const (
	// requestTimeout covers one attempt: a screenshot in, a few hundred tokens out.
	requestTimeout = 120 * time.Second
	maxAttempts    = 3
	maxResponse    = 4 << 20
	maxErrorText   = 300
)

// OpenRouter calls OpenRouter's chat completions with images and a JSON schema.
type OpenRouter struct {
	apiKey    string
	model     string
	baseURL   string
	reasoning string
	http      *http.Client
}

// sharedHTTP is one pool for every client, since a client is built per session key.
var sharedHTTP = llmhttp.NewClient(requestTimeout)

// NewOpenRouter is a client for model on baseURL. reasoning is the effort sent to the
// provider ("none", "low", "medium", "high"); empty sends none of it.
func NewOpenRouter(apiKey, model, baseURL, reasoning string) *OpenRouter {
	return &OpenRouter{
		apiKey:    strings.TrimSpace(apiKey),
		model:     model,
		baseURL:   strings.TrimRight(baseURL, "/"),
		reasoning: strings.TrimSpace(reasoning),
		http:      sharedHTTP,
	}
}

// Name is the model id.
func (c *OpenRouter) Name() string { return c.model }

type chatRequest struct {
	Model          string           `json:"model"`
	Messages       []chatMessage    `json:"messages"`
	ResponseFormat *responseFormat  `json:"response_format,omitempty"`
	Reasoning      *reasoningEffort `json:"reasoning,omitempty"`
	Usage          usageOption      `json:"usage"`
}

type usageOption struct {
	Include bool `json:"include"`
}

type reasoningEffort struct {
	Effort string `json:"effort"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type contentPart struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *imageURL `json:"image_url,omitempty"`
}

type imageURL struct {
	URL string `json:"url"`
}

type responseFormat struct {
	Type       string      `json:"type"`
	JSONSchema *jsonSchema `json:"json_schema,omitempty"`
}

type jsonSchema struct {
	Name   string          `json:"name"`
	Strict bool            `json:"strict"`
	Schema json.RawMessage `json:"schema"`
}

type chatResponse struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Choices  []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens        int     `json:"prompt_tokens"`
		CompletionTokens    int     `json:"completion_tokens"`
		Cost                float64 `json:"cost"`
		PromptTokensDetails struct {
			CachedTokens     int `json:"cached_tokens"`
			CacheWriteTokens int `json:"cache_write_tokens"`
		} `json:"prompt_tokens_details"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// body builds the provider request. A message with images sends its content as parts.
func (c *OpenRouter) body(req Request) ([]byte, error) {
	out := chatRequest{Model: c.model, Usage: usageOption{Include: true}}
	for _, message := range req.Messages {
		if len(message.Images) == 0 {
			out.Messages = append(out.Messages, chatMessage{Role: message.Role, Content: message.Text})
			continue
		}
		parts := []contentPart{{Type: "text", Text: message.Text}}
		for _, image := range message.Images {
			parts = append(parts, contentPart{Type: "image_url", ImageURL: &imageURL{URL: image}})
		}
		out.Messages = append(out.Messages, chatMessage{Role: message.Role, Content: parts})
	}
	if len(req.Schema) > 0 {
		out.ResponseFormat = &responseFormat{
			Type:       "json_schema",
			JSONSchema: &jsonSchema{Name: req.SchemaName, Strict: true, Schema: req.Schema},
		}
	}
	if c.reasoning != "" {
		out.Reasoning = &reasoningEffort{Effort: c.reasoning}
	}
	return json.Marshal(out)
}

// Complete sends the request and retries a rate limit or a provider failure.
func (c *OpenRouter) Complete(ctx context.Context, req Request) (Response, error) {
	if c.apiKey == "" {
		return Response{}, ErrNoKey
	}
	body, err := c.body(req)
	if err != nil {
		return Response{}, fmt.Errorf("encode model request: %w", err)
	}
	var lastErr error
	var usage Usage
	var requests []Attempt
	var backoff time.Duration
	started := time.Now()
	stats := MeasureMessages(req.Messages)
	finish := func(response Response, attempts int) Response {
		response.Latency, response.Attempts = time.Since(started), attempts
		response.StartedAt, response.Requests = started, requests
		return response
	}
	for attempt := 0; attempt < maxAttempts; attempt++ {
		response, retryAfter, err := c.once(ctx, body)
		usage.Add(response.Usage)
		for _, request := range response.Requests {
			request.BackoffMs = backoff.Milliseconds()
			request.Body = &stats
			requests = append(requests, request)
		}
		if err == nil {
			response.Usage = usage
			return finish(response, attempt+1), nil
		}
		lastErr = err
		if ctx.Err() != nil || !retryable(err) || attempt == maxAttempts-1 {
			break
		}
		backoff = llmhttp.RetryDelay(attempt, retryAfter)
		select {
		case <-ctx.Done():
			return finish(Response{Usage: usage}, attempt+1), ctx.Err()
		case <-time.After(backoff):
		}
	}
	return finish(Response{Usage: usage}, maxAttempts), lastErr
}

// retryable is true for a rate limit, a provider failure, or a dropped connection.
func retryable(err error) bool {
	var status *StatusError
	if errors.As(err, &status) {
		return llmhttp.Retryable(status.Status)
	}
	return true
}

func (c *OpenRouter) once(ctx context.Context, body []byte) (got Response, retryAfter string, err error) {
	ctx, probe := Begin(ctx)
	var status, size int
	var provider, generation string
	defer func() {
		attempt := probe.Finish(status, len(body), size, err)
		attempt.Provider, attempt.GenerationID = provider, generation
		got.Requests = []Attempt{attempt}
	}()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Response{}, "", fmt.Errorf("build model request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return Response{}, "", fmt.Errorf("call model: %w", err)
	}
	defer response.Body.Close()
	status = response.StatusCode
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponse))
	size = len(payload)
	if err != nil {
		return Response{}, "", fmt.Errorf("read model response: %w", err)
	}
	var decoded chatResponse
	jsonErr := json.Unmarshal(payload, &decoded)
	provider, generation = decoded.Provider, decoded.ID
	got = Response{
		Model: decoded.Model,
		Usage: Usage{
			InputTokens:      decoded.Usage.PromptTokens,
			OutputTokens:     decoded.Usage.CompletionTokens,
			CachedTokens:     decoded.Usage.PromptTokensDetails.CachedTokens,
			CacheWriteTokens: decoded.Usage.PromptTokensDetails.CacheWriteTokens,
			Cost:             decoded.Usage.Cost,
		},
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := ""
		if decoded.Error != nil {
			message = decoded.Error.Message
		}
		return got, response.Header.Get("Retry-After"), &StatusError{Status: response.StatusCode, Message: clip(message, maxErrorText)}
	}
	if jsonErr != nil {
		return got, "", fmt.Errorf("read model response: %w", jsonErr)
	}
	if decoded.Error != nil && decoded.Error.Message != "" {
		return got, "", &StatusError{Status: http.StatusBadGateway, Message: clip(decoded.Error.Message, maxErrorText)}
	}
	if len(decoded.Choices) == 0 {
		return got, "", fmt.Errorf("model returned no choices")
	}
	got.Content = decoded.Choices[0].Message.Content
	got.FinishReason = decoded.Choices[0].FinishReason
	return got, "", nil
}

func clip(text string, max int) string {
	text = strings.TrimSpace(text)
	if len(text) <= max {
		return text
	}
	return text[:max] + "…"
}
