package agent

import (
	"strings"
	"unicode"
)

// Two labels agree when they name the same question: the model's words for a control and another's (the
// model's own on another look, a review's, the label the page gives a control). Agreement only ever finds
// where something is (the control a point that missed its field meant, marks.go) or matches the model's
// readings with each other; what the page calls a control never answers a question about it.

const (
	// minLabelAgreeChars is the least a label may have, once its words are read, to agree with another:
	// a label of a letter or two would begin too many others.
	minLabelAgreeChars = 3
	// longLabelAgreeChars is a beginning long enough to agree in the middle of a word: both the model's
	// label and the page's are cut short at a fixed length, which falls where it falls.
	longLabelAgreeChars = 24
)

// labelWords is a label as words only: lower case, with every run of anything but a letter or a digit
// made one space, so case, spacing and punctuation (a required mark, a colon, an ellipsis) do not count.
func labelWords(label string) string {
	var out strings.Builder
	space := false
	for _, r := range strings.ToLower(label) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if space && out.Len() > 0 {
				out.WriteByte(' ')
			}
			space = false
			out.WriteRune(r)
			continue
		}
		space = true
	}
	return out.String()
}

// labelsAgree is whether the name the model gave a control and the name the page gives it are the same
// words, or one begins with the other's words: the model writes a long question in a few words, and the
// page's own label is cut short. Neither may be empty or too short.
func labelsAgree(planned, page string) bool {
	a, b := labelWords(planned), labelWords(page)
	if len(a) < minLabelAgreeChars || len(b) < minLabelAgreeChars {
		return false
	}
	return a == b || beginsWithWords(a, b) || beginsWithWords(b, a)
}

// beginsWithWords is whether text starts with the whole words of prefix, or with a long enough prefix
// wherever it was cut.
func beginsWithWords(text, prefix string) bool {
	if !strings.HasPrefix(text, prefix) {
		return false
	}
	return len(text) == len(prefix) || text[len(prefix)] == ' ' || len(prefix) >= longLabelAgreeChars
}
