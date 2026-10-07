package openai

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

	"github.com/sid0709/OpenSeat/backend-core/llmhttp"
)

const (
	requestTimeout = 90 * time.Second
	maxAttempts    = 4
	// schemaInstruction introduces the schema when the provider only promises valid JSON.
	schemaInstruction = "\n\nReply with one JSON object and nothing else. It must match this JSON schema exactly, with every property present:\n"
)

var ErrMissingAPIKey = errors.New("OPENAI_API_KEY is not set")

type Client struct {
	apiKey      string
	model       string
	searchModel string
	baseURL     string
	missingKey  error
	jsonObject  bool
	noThinking  bool
	noReasoning bool
	http        *http.Client
	searchHTTP  *http.Client
}

func New(apiKey, model, baseURL string) *Client {
	return &Client{
		apiKey:     strings.TrimSpace(apiKey),
		model:      model,
		baseURL:    strings.TrimRight(baseURL, "/"),
		missingKey: ErrMissingAPIKey,
		http:       llmhttp.NewClient(requestTimeout),
		searchHTTP: llmhttp.NewClient(searchTimeout),
	}
}

// ForProvider adapts the client to an OpenAI-compatible provider: missingKey is
// returned without an API key and should wrap ErrMissingAPIKey. jsonObject asks for
// plain JSON mode and puts the schema in the system prompt, for providers without
// strict json_schema output. noThinking turns off the provider's reasoning mode.
func (c *Client) ForProvider(missingKey error, jsonObject, noThinking bool) *Client {
	c.missingKey = missingKey
	c.jsonObject = jsonObject
	c.noThinking = noThinking
	return c
}

func (c *Client) Model() string {
	return c.model
}

// Ready reports whether the client has an API key.
func (c *Client) Ready() bool {
	return c != nil && c.apiKey != ""
}

func (c *Client) JSON(ctx context.Context, system, user string, schema json.RawMessage) ([]byte, error) {
	if c == nil {
		return nil, ErrMissingAPIKey
	}
	if c.apiKey == "" {
		Note(ctx, Usage{Model: c.model, Error: c.missingKey.Error(), ErrorKind: ErrorKindNoAPIKey})
		return nil, c.missingKey
	}

	body, err := json.Marshal(c.chatRequest(system, user, schema))
	if err != nil {
		return nil, err
	}

	call := callNote{model: c.model, started: time.Now(), request: StoredRequest(body)}
	var last error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		attemptStarted := time.Now()
		got, err := c.complete(ctx, body)
		call.attempts = attempt + 1
		call.status = got.status
		call.finishReason = got.finishReason
		call.response = got.stored
		call.spent.Add(got.usage)
		if err == nil && got.status >= 200 && got.status < 300 {
			if strings.TrimSpace(got.content) == "" {
				LogProvider(ctx, "chat", c.model, got.status, attempt+1, len(body), attemptStarted, got.usage, ErrEmptyResponse, "", false)
				call.note(ctx, ErrEmptyResponse)
				return nil, ErrEmptyResponse
			}
			model := got.usage.Model
			if model == "" {
				model = c.model
			}
			LogProvider(ctx, "chat", model, got.status, attempt+1, len(body), attemptStarted, got.usage, nil, "", false)
			call.note(ctx, nil)
			return []byte(got.content), nil
		}
		callErr := err
		if callErr == nil {
			callErr = statusError(got.status, got.content)
		}
		willRetry := attempt < maxAttempts-1 && ctx.Err() == nil && (err != nil || llmhttp.Retryable(got.status))
		LogProvider(ctx, "chat", c.model, got.status, attempt+1, len(body), attemptStarted, got.usage, callErr, got.retryAfter, willRetry)
		if err == nil && !llmhttp.Retryable(got.status) {
			call.note(ctx, callErr)
			return nil, callErr
		}
		if err != nil && ctx.Err() != nil {
			call.note(ctx, ctx.Err())
			return nil, err
		}
		last = callErr
		if !willRetry {
			break
		}
		if err := llmhttp.Wait(ctx, llmhttp.RetryDelay(attempt, got.retryAfter)); err != nil {
			call.note(ctx, err)
			return nil, err
		}
	}
	if last == nil {
		last = fmt.Errorf("model request failed")
	}
	call.note(ctx, last)
	return nil, last
}

// callNote collects one logical call across its attempts for Note.
type callNote struct {
	model        string
	started      time.Time
	attempts     int
	status       int
	finishReason string
	request      string
	response     string
	spent        Usage
}

func (n callNote) note(ctx context.Context, err error) {
	usage := n.spent
	if usage.Model == "" {
		usage.Model = n.model
	}
	usage.Duration = time.Since(n.started)
	usage.Attempts = n.attempts
	usage.HTTPStatus = n.status
	usage.FinishReason = n.finishReason
	usage.Request = n.request
	usage.Response = n.response
	if err != nil {
		usage.Error = err.Error()
		usage.ErrorKind = ClassifyError(err, n.status)
	}
	Note(ctx, usage)
}

func (c *Client) chatRequest(system, user string, schema json.RawMessage) chatRequest {
	request := chatRequest{
		Model: c.model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		ResponseFormat: responseFormat{
			Type: "json_schema",
			JSONSchema: &jsonSchemaBody{
				Name:   "app_job",
				Strict: true,
				Schema: schema,
			},
		},
	}
	if c.jsonObject {
		request.Messages[0].Content = system + schemaInstruction + string(schema)
		request.ResponseFormat = responseFormat{Type: "json_object"}
	}
	if c.noThinking {
		request.Thinking = &thinking{Type: "disabled"}
	}
	if c.noReasoning {
		request.Reasoning = &reasoningEffort{Effort: reasoningEffortNone}
	}
	return request
}

// completion is one attempt's reply. content holds the provider's error message on a non-2xx status.
type completion struct {
	content      string
	usage        Usage
	finishReason string
	stored       string
	status       int
	retryAfter   string
}

func (c *Client) complete(ctx context.Context, body []byte) (completion, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return completion{}, err
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return completion{}, err
	}
	defer response.Body.Close()

	got := completion{status: response.StatusCode, retryAfter: response.Header.Get("Retry-After")}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return got, err
	}
	got.stored = StoredResponse(payload)
	var decoded chatResponse
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return got, fmt.Errorf("read model response: %w", err)
	}
	model := decoded.Model
	if model == "" {
		model = c.model
	}
	got.usage, _ = ParseChatUsage(model, decoded.Usage)
	if decoded.Error != nil && decoded.Error.Message != "" && (response.StatusCode < 200 || response.StatusCode >= 300) {
		got.content = decoded.Error.Message
		return got, nil
	}
	if len(decoded.Choices) > 0 {
		got.content = decoded.Choices[0].Message.Content
		got.finishReason = decoded.Choices[0].FinishReason
	}
	return got, nil
}

func statusError(status int, message string) error {
	if strings.TrimSpace(message) != "" && !strings.HasPrefix(strings.TrimSpace(message), "{") {
		return fmt.Errorf("model request failed: %s", strings.TrimSpace(message))
	}
	return fmt.Errorf("model request failed (%d)", status)
}

type chatRequest struct {
	Model          string           `json:"model"`
	Messages       []chatMessage    `json:"messages"`
	ResponseFormat responseFormat   `json:"response_format"`
	Thinking       *thinking        `json:"thinking,omitempty"`
	Reasoning      *reasoningEffort `json:"reasoning,omitempty"`
}

type reasoningEffort struct {
	Effort string `json:"effort"`
}

type thinking struct {
	Type string `json:"type"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responseFormat struct {
	Type       string          `json:"type"`
	JSONSchema *jsonSchemaBody `json:"json_schema,omitempty"`
}

type jsonSchemaBody struct {
	Name   string          `json:"name"`
	Strict bool            `json:"strict"`
	Schema json.RawMessage `json:"schema"`
}

type chatResponse struct {
	Model   string          `json:"model"`
	Usage   json.RawMessage `json:"usage"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}
