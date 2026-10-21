package decide

import (
	"encoding/json"
	"fmt"
	"sort"
)

// A Decisions API takes a state and typed questions and answers each with probabilities. OpenRouter's and
// OpenAI's own differ on the wire: OpenRouter's takes `state` parts and a map of questions (`noul`, `choice`
// with a map of criteria) and answers with a map; OpenAI's takes `input` as a user message of `input_text` and
// `input_image` parts and an array of named questions (`predicate`, `choice` with an array of choices) and
// answers with an array, in the questions' order. The agent asks in one shape (Request, Response) and each
// client speaks its provider's.

// wireFormat encodes a request and decodes an answer for one provider.
type wireFormat interface {
	encode(model string, req Request) ([]byte, error)
	decode(payload []byte) (Response, error)
}

// openRouterFormat is OpenRouter's Decisions API, whose shape is the agent's own.
type openRouterFormat struct{}

func (openRouterFormat) encode(model string, req Request) ([]byte, error) {
	return json.Marshal(struct {
		Model     string              `json:"model"`
		State     []Part              `json:"state"`
		Questions map[string]Question `json:"questions"`
	}{model, req.State, req.Questions})
}

func (openRouterFormat) decode(payload []byte) (Response, error) {
	var decoded Response
	err := json.Unmarshal(payload, &decoded)
	return decoded, err
}

// openAIFormat is OpenAI's own Decisions API (POST /v1/decisions).
type openAIFormat struct{}

// OpenAI's names for the kinds of question and of state part.
const (
	openAIPredicate  = "predicate"
	openAIChoice     = "choice"
	openAIRefusal    = "refusal"
	openAIInputText  = "input_text"
	openAIInputImage = "input_image"
	openAIUserRole   = "user"
)

type openAIPart struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"`
}

type openAIMessage struct {
	Role    string       `json:"role"`
	Content []openAIPart `json:"content"`
}

type openAIOption struct {
	Value       string `json:"value"`
	Description string `json:"description"`
}

type openAIQuestion struct {
	Type         string         `json:"type"`
	Name         string         `json:"name"`
	Instructions string         `json:"instructions"`
	Choices      []openAIOption `json:"choices,omitempty"`
}

type openAIWeight struct {
	Value       string  `json:"value"`
	Probability float64 `json:"probability"`
}

type openAIAnswer struct {
	Type          string         `json:"type"`
	Name          string         `json:"name"`
	Probability   *float64       `json:"probability,omitempty"`
	Choice        string         `json:"choice,omitempty"`
	Probabilities []openAIWeight `json:"probabilities,omitempty"`
	Confidence    float64        `json:"confidence,omitempty"`
}

type openAIUsage struct {
	InputTokens        int `json:"input_tokens"`
	OutputTokens       int `json:"output_tokens"`
	InputTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"input_tokens_details"`
}

func (openAIFormat) encode(model string, req Request) ([]byte, error) {
	content := make([]openAIPart, 0, len(req.State))
	for _, part := range req.State {
		switch {
		case part.Type == partImage && part.ImageURL != nil:
			content = append(content, openAIPart{Type: openAIInputImage, ImageURL: part.ImageURL.URL})
		case part.Text != "":
			content = append(content, openAIPart{Type: openAIInputText, Text: part.Text})
		}
	}
	names := make([]string, 0, len(req.Questions))
	for name := range req.Questions {
		names = append(names, name)
	}
	sort.Strings(names)
	questions := make([]openAIQuestion, 0, len(names))
	for _, name := range names {
		question := req.Questions[name]
		out := openAIQuestion{Type: openAIPredicate, Name: name, Instructions: question.Instructions}
		if question.Type == TypeChoice {
			out.Type = openAIChoice
			keys := make([]string, 0, len(question.Criteria))
			for key := range question.Criteria {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				out.Choices = append(out.Choices, openAIOption{Value: key, Description: question.Criteria[key]})
			}
		}
		questions = append(questions, out)
	}
	return json.Marshal(struct {
		Model     string           `json:"model"`
		Input     []openAIMessage  `json:"input"`
		Questions []openAIQuestion `json:"questions"`
	}{model, []openAIMessage{{Role: openAIUserRole, Content: content}}, questions})
}

func (openAIFormat) decode(payload []byte) (Response, error) {
	var decoded struct {
		Model   string         `json:"model"`
		Answers []openAIAnswer `json:"answers"`
		Usage   openAIUsage    `json:"usage"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return Response{}, err
	}
	out := Response{
		Model:   decoded.Model,
		Answers: make(map[string]Answer, len(decoded.Answers)),
		Usage:   Usage{InputTokens: decoded.Usage.InputTokens, OutputTokens: decoded.Usage.OutputTokens},
	}
	for _, answer := range decoded.Answers {
		switch answer.Type {
		case openAIPredicate:
			out.Answers[answer.Name] = Answer{Type: TypeNoul, Noul: answer.Probability}
		case openAIChoice:
			weights := make(map[string]float64, len(answer.Probabilities))
			for _, weight := range answer.Probabilities {
				weights[weight.Value] = weight.Probability
			}
			out.Answers[answer.Name] = Answer{Type: TypeChoice, Choice: answer.Choice, Confidence: answer.Confidence, Probabilities: weights}
		case openAIRefusal:
			// A question the model declined is left unanswered: the caller treats it as no answer.
		default:
			return Response{}, fmt.Errorf("unknown answer type %q for %q", answer.Type, answer.Name)
		}
	}
	return out, nil
}
