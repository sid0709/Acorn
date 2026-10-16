package acorn

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

var fencedJSON = regexp.MustCompile("(?is)```(?:json)?\\s*(.*?)```")

// jsonObject finds the JSON object in a model reply, which may be fenced or wrapped in prose.
func jsonObject(text string) (string, error) {
	trimmed := strings.TrimSpace(text)
	if strings.HasPrefix(trimmed, "{") {
		return trimmed, nil
	}
	if match := fencedJSON.FindStringSubmatch(trimmed); match != nil {
		return strings.TrimSpace(match[1]), nil
	}
	start, end := strings.Index(trimmed, "{"), strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		return trimmed[start : end+1], nil
	}
	return "", errors.New("model returned no JSON object")
}

func decodeObject(text string, dest any) error {
	object, err := jsonObject(text)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(object), dest)
}

// typingField is a text field a writer answers.
type typingField struct {
	ElementIndex int
	Question     string
	Role         string
}

func parseProseAnswers(text string, allowed map[int]bool) (map[int]string, error) {
	var parsed struct {
		Answers []struct {
			ElementIndex any    `json:"element_index"`
			Value        string `json:"value"`
		} `json:"answers"`
	}
	if err := decodeObject(text, &parsed); err != nil {
		return nil, err
	}
	answers := map[int]string{}
	for _, row := range parsed.Answers {
		var index int
		switch value := row.ElementIndex.(type) {
		case float64:
			index = int(value)
		case string:
			if _, err := fmt.Sscanf(strings.TrimSpace(value), "%d", &index); err != nil {
				continue
			}
		default:
			continue
		}
		if allowed != nil && !allowed[index] {
			continue
		}
		if value := strings.TrimSpace(row.Value); value != "" {
			answers[index] = value
		}
	}
	return answers, nil
}

// jobContext is the title and company of the bound job, when the extension sent one.
func jobContext(page map[string]any) string {
	job, _ := page["job"].(map[string]any)
	var parts []string
	for _, key := range []string{"title", "company", "companyName"} {
		if value, ok := job[key].(string); ok && strings.TrimSpace(value) != "" {
			parts = append(parts, key+": "+strings.TrimSpace(value))
		}
	}
	return strings.Join(parts, "\n")
}

// proseUserPrompt puts the profile first, then the question to answer.
func proseUserPrompt(applicant string, fields []typingField, page map[string]any) string {
	blocks := make([]string, 0, len(fields))
	for _, field := range fields {
		blocks = append(blocks, fmt.Sprintf("element_index: %d\nrole: %s\nquestion: %s\ndraft: (none)", field.ElementIndex, field.Role, field.Question))
	}
	job := ""
	if context := jobContext(page); context != "" {
		job = "Job context:\n" + context + "\n\n"
	}
	return strings.TrimSpace("PROFILE JSON:\n" + applicant + "\n\n" + job +
		"Typing fields (answer every element_index):\n" + strings.Join(blocks, "\n\n") +
		"\n\nReturn json with one answers[].value per field.")
}

// qaFieldIndex is the single field a Q&A question is written as.
const qaFieldIndex = 1

// indentedJSON is JSON.stringify(value, null, 2): readable, with no HTML escaping.
func indentedJSON(value any) string {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return "{}"
	}
	return strings.TrimRight(out.String(), "\n")
}
