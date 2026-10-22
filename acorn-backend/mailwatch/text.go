package mailwatch

import (
	"html"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/mailbox"
	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// plainText is the readable text of an email: its plain part, else its HTML with the markup
// stripped (scripts, styles and the head dropped, block elements on their own lines), cut to at
// most max runes.
func plainText(message mailbox.FullMessage, max int) string {
	text := strings.TrimSpace(message.Text)
	if text == "" {
		text = htmlToText(message.HTML)
	}
	text = strings.Join(strings.Fields(strings.ReplaceAll(text, " ", " ")), " ")
	runes := []rune(text)
	if len(runes) > max {
		return string(runes[:max])
	}
	return text
}

var skippedElements = map[atom.Atom]bool{atom.Script: true, atom.Style: true, atom.Head: true}

func htmlToText(source string) string {
	if strings.TrimSpace(source) == "" {
		return ""
	}
	var b strings.Builder
	skip := 0
	tokens := xhtml.NewTokenizer(strings.NewReader(source))
	for {
		switch tokens.Next() {
		case xhtml.ErrorToken:
			return b.String()
		case xhtml.StartTagToken, xhtml.SelfClosingTagToken:
			if skippedElements[tokens.Token().DataAtom] {
				skip++
			}
			b.WriteString(" ")
		case xhtml.EndTagToken:
			if skippedElements[tokens.Token().DataAtom] && skip > 0 {
				skip--
			}
			b.WriteString(" ")
		case xhtml.TextToken:
			if skip == 0 {
				b.WriteString(html.UnescapeString(string(tokens.Text())))
			}
		}
	}
}
