package mailcode

import (
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/sid0709/acorn/acorn-backend/mailbox"
)

const (
	// minCodeLen and maxCodeLen bound a token that can be a one-time code.
	minCodeLen = 4
	maxCodeLen = 12
	// maxElementChars bounds the text of an element that can be a code on its own.
	maxElementChars = 32
	// maxCandidates bounds the codes or links one email offers Jev.
	maxCandidates = 40
	// codeContext is how many characters of the line before a link Jev reads.
	codeContext = 90
)

var (
	// webAddress finds addresses in plain text; they are links, never codes.
	webAddress = regexp.MustCompile(`(?i)\bhttps?://[^\s<>"'()]+`)
	// emailAddress is removed before codes are read, so a mailbox name is not one.
	emailAddress = regexp.MustCompile(`[\w.+-]+@[\w-]+(\.[\w-]+)+`)
	// codeToken is one run of letters and digits, optionally in dash-joined groups.
	codeToken = regexp.MustCompile(`[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*`)
	// codeElement is the text of an element or line that is only a code: up to four groups of letters
	// and digits, joined by a space or a dash. A link, an address or a sentence is not.
	codeElement = regexp.MustCompile(`^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+){0,3}$`)
	spaces      = regexp.MustCompile(`\s+`)
)

// secret is one code or link an email holds: Value is what the run uses,
// Description is all the decision model reads.
type secret struct {
	Value       string
	Description string
	// Alone is a code that stands alone in the email (its own element or line).
	Alone bool
}

// bodyText is the email's readable text: its plain part, else its HTML as text.
func bodyText(message mailbox.FullMessage) string {
	if text := strings.TrimSpace(message.Text); text != "" {
		return text
	}
	return htmlText(message.HTML)
}

// codeCandidates are what the email offers as its one-time code. Which is the code is the
// decision model's call: it reads the email and chooses among these texts (the texts are taken
// from the email by this code, never written by the model). The first candidates are text that
// stands alone: an element (or a line of a plain email) whose whole text is only a code-sized run
// of letters and digits, which is how a site sets a code apart. That is a property of the
// email's layout, not of the code, so a code of any letters and digits qualifies. After them come
// tokens inside sentences that look like codes, for an email that writes its code in a sentence.
func codeCandidates(message mailbox.FullMessage) []secret {
	text := emailAddress.ReplaceAllString(webAddress.ReplaceAllString(bodyText(message), " "), " ")
	text = spaces.ReplaceAllString(text, " ")
	seen := map[string]bool{}
	var out []secret
	add := func(token string, alone bool) {
		if seen[token] || len(out) == maxCandidates {
			return
		}
		seen[token] = true
		out = append(out, secret{Value: token, Description: fmt.Sprintf("The code is %q.", token), Alone: alone})
	}
	for _, token := range elementTexts(message) {
		add(token, true)
	}
	for _, span := range codeToken.FindAllStringIndex(text, -1) {
		if token := text[span[0]:span[1]]; looksLikeCode(token) {
			add(token, false)
		}
	}
	return out
}

// elementTexts are the texts that stand alone in the email and are only a code-sized run of
// letters and digits: each innermost HTML element whose whole text is one, or each such line of a
// plain-text email.
func elementTexts(message mailbox.FullMessage) []string {
	var texts []string
	if strings.TrimSpace(message.HTML) != "" {
		texts = htmlElementTexts(message.HTML)
	} else {
		for _, line := range strings.Split(message.Text, "\n") {
			texts = append(texts, line)
		}
	}
	var out []string
	seen := map[string]bool{}
	for _, text := range texts {
		text = strings.TrimSpace(spaces.ReplaceAllString(strings.ReplaceAll(text, "\u00a0", " "), " "))
		n := len([]rune(text))
		if n < minCodeLen || n > maxElementChars || !codeElement.MatchString(text) || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, text)
	}
	return out
}

// htmlElementTexts is the whole text of every innermost element of an HTML body: an element whose
// text is no more than one of its children's is left to that child.
func htmlElementTexts(source string) []string {
	doc, err := html.Parse(strings.NewReader(source))
	if err != nil {
		return nil
	}
	var out []string
	collapse := func(text string) string {
		return strings.TrimSpace(spaces.ReplaceAllString(strings.ReplaceAll(text, "\u00a0", " "), " "))
	}
	var walk func(*html.Node) string
	walk = func(node *html.Node) string {
		if node.Type == html.TextNode {
			return node.Data
		}
		if node.Type == html.ElementNode {
			switch node.DataAtom {
			case atom.Script, atom.Style, atom.Head, atom.Title:
				return ""
			}
		}
		var all strings.Builder
		var children []string
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			text := walk(child)
			all.WriteString(text)
			if child.Type == html.ElementNode {
				children = append(children, collapse(text))
			}
		}
		if node.Type == html.ElementNode {
			whole := collapse(all.String())
			if whole != "" && !slices.Contains(children, whole) {
				out = append(out, whole)
			}
		}
		return all.String()
	}
	walk(doc)
	return out
}

// looksLikeCode is whether a token inside a sentence can be a one-time code: of code length, and
// not an ordinary lower-case or capitalised word (it holds a digit, or a capital after its first
// letter, or is all capitals).
func looksLikeCode(token string) bool {
	plain := strings.ReplaceAll(token, "-", "")
	letters := []rune(plain)
	if n := len(letters); n < minCodeLen || n > maxCodeLen {
		return false
	}
	digit, lower, innerUpper := false, false, false
	for i, r := range letters {
		switch {
		case unicode.IsDigit(r):
			digit = true
		case unicode.IsLower(r):
			lower = true
		case unicode.IsUpper(r) && i > 0:
			innerUpper = true
		}
	}
	return digit || innerUpper || !lower
}

// linkCandidates are the web links in the email: each anchor with its text, or
// bare addresses from the plain text. Jev reads a link without its query string
// or fragment, where sites keep the token.
func linkCandidates(message mailbox.FullMessage) []secret {
	seen := map[string]bool{}
	var out []secret
	add := func(raw, text, before string) {
		// The value is the address exactly as the email writes it, so it can be
		// confirmed against the email's own content before it is used.
		value := strings.TrimSpace(raw)
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return
		}
		if seen[parsed.String()] || len(out) == maxCandidates {
			return
		}
		seen[parsed.String()] = true
		description := "The link to " + parsed.Host + parsed.EscapedPath()
		if text = strings.TrimSpace(spaces.ReplaceAllString(text, " ")); text != "" && !webAddress.MatchString(text) {
			description = fmt.Sprintf("The link %q to %s%s", text, parsed.Host, parsed.EscapedPath())
		}
		if before = strings.TrimSpace(spaces.ReplaceAllString(before, " ")); before != "" {
			description += fmt.Sprintf(", after the words %q", before)
		}
		description += "."
		out = append(out, secret{Value: value, Description: description})
	}
	for _, anchor := range htmlAnchors(message.HTML) {
		add(anchor.href, anchor.text, anchor.before)
	}
	text := bodyText(message)
	for _, span := range webAddress.FindAllStringIndex(text, -1) {
		add(text[span[0]:span[1]], "", lineAround(text, span[0]))
	}
	return out
}

// lineAround is the plain-text line before an address, which often names it.
func lineAround(text string, at int) string {
	start := strings.LastIndex(text[:at], "\n")
	line := strings.TrimSpace(text[start+1 : at])
	if line == "" && start > 0 {
		prev := strings.LastIndex(text[:start], "\n")
		line = strings.TrimSpace(text[prev+1 : start])
	}
	runes := []rune(line)
	if len(runes) > codeContext {
		runes = runes[len(runes)-codeContext:]
	}
	return string(runes)
}

type anchor struct {
	href string
	text string
	// before is the email's text right before the link, which often says what it is for.
	before string
}

// htmlAnchors lists every <a href> with its text (or an image's alt text).
func htmlAnchors(source string) []anchor {
	if strings.TrimSpace(source) == "" {
		return nil
	}
	var (
		out     []anchor
		current *anchor
		text    strings.Builder
		// seen is the email's text so far, outside links.
		seen strings.Builder
	)
	tokens := html.NewTokenizer(strings.NewReader(source))
	for {
		switch tokens.Next() {
		case html.ErrorToken:
			return out
		case html.StartTagToken, html.SelfClosingTagToken:
			token := tokens.Token()
			switch token.DataAtom {
			case atom.A:
				if href := attr(token, "href"); href != "" {
					current = &anchor{href: href, before: tail(seen.String(), codeContext)}
					text.Reset()
				}
			case atom.Img:
				if current != nil {
					text.WriteString(" " + attr(token, "alt"))
				}
			}
		case html.TextToken:
			if current != nil {
				text.Write(tokens.Text())
			} else {
				seen.Write(tokens.Text())
				seen.WriteString(" ")
			}
		case html.EndTagToken:
			if name, _ := tokens.TagName(); current != nil && string(name) == atom.A.String() {
				current.text = html.UnescapeString(text.String())
				out = append(out, *current)
				current = nil
			}
		}
	}
}

// htmlText is the readable text of an HTML body: scripts and styles dropped,
// block elements on their own lines.
func htmlText(source string) string {
	if strings.TrimSpace(source) == "" {
		return ""
	}
	var b strings.Builder
	skip := 0
	tokens := html.NewTokenizer(strings.NewReader(source))
	for {
		switch tokens.Next() {
		case html.ErrorToken:
			return strings.TrimSpace(b.String())
		case html.StartTagToken, html.SelfClosingTagToken:
			token := tokens.Token()
			if token.DataAtom == atom.Script || token.DataAtom == atom.Style || token.DataAtom == atom.Head {
				skip++
			}
			if blockElements[token.DataAtom] {
				b.WriteString("\n")
			}
		case html.EndTagToken:
			token := tokens.Token()
			if (token.DataAtom == atom.Script || token.DataAtom == atom.Style || token.DataAtom == atom.Head) && skip > 0 {
				skip--
			}
			if blockElements[token.DataAtom] {
				b.WriteString("\n")
			}
		case html.TextToken:
			if skip == 0 {
				b.WriteString(html.UnescapeString(string(tokens.Text())))
			}
		}
	}
}

var blockElements = map[atom.Atom]bool{
	atom.Br: true, atom.P: true, atom.Div: true, atom.Tr: true, atom.Td: true, atom.Li: true,
	atom.H1: true, atom.H2: true, atom.H3: true, atom.H4: true, atom.Table: true,
}

func attr(token html.Token, name string) string {
	for _, a := range token.Attr {
		if a.Key == name {
			return strings.TrimSpace(a.Val)
		}
	}
	return ""
}

// tail is the last max runes of text, starting on a whole word.
func tail(text string, max int) string {
	runes := []rune(strings.TrimSpace(spaces.ReplaceAllString(text, " ")))
	if len(runes) <= max {
		return string(runes)
	}
	cut := string(runes[len(runes)-max:])
	if i := strings.IndexRune(cut, ' '); i >= 0 {
		cut = cut[i+1:]
	}
	return cut
}

// confirmed says whether value is written in the message itself: in its HTML (as
// a link's address or its text) or in its plain text. A value that is not there
// is never used, whatever picked it.
func confirmed(message mailbox.FullMessage, value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, source := range []string{html.UnescapeString(message.HTML), message.Text, bodyText(message)} {
		if strings.Contains(source, value) {
			return true
		}
	}
	return false
}
