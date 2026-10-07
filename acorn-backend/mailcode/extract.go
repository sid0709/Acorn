package mailcode

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
)

const (
	// minCodeLen and maxCodeLen bound a token that can be a one-time code.
	minCodeLen = 4
	maxCodeLen = 12
	// maxCandidates bounds the codes or links one email offers Jev.
	maxCandidates = 40
	// codeContext is how many characters on each side of a code Jev reads.
	codeContext = 90
	// codeMask stands in for a code inside its own context, so Jev never reads the code.
	codeMask = "[CODE]"
	// otherMask stands in for every other candidate in that context.
	otherMask = "[another candidate]"
)

var (
	// webAddress finds addresses in plain text; they are links, never codes.
	webAddress = regexp.MustCompile(`(?i)\bhttps?://[^\s<>"'()]+`)
	// emailAddress is removed before codes are read, so a mailbox name is not one.
	emailAddress = regexp.MustCompile(`[\w.+-]+@[\w-]+(\.[\w-]+)+`)
	// codeToken is one run of letters and digits, optionally in dash-joined groups.
	codeToken = regexp.MustCompile(`[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*`)
	spaces    = regexp.MustCompile(`\s+`)
)

// secret is one code or link an email holds: Value is what the run uses,
// Description is all the decision model reads.
type secret struct {
	Value       string
	Description string
}

// bodyText is the email's readable text: its plain part, else its HTML as text.
func bodyText(message mailbox.FullMessage) string {
	if text := strings.TrimSpace(message.Text); text != "" {
		return text
	}
	return htmlText(message.HTML)
}

// codeCandidates are the tokens in the email that can be a one-time code: a
// run of letters and digits of code length holding a digit, or all capitals.
// Which one is the code is the decision model's call, from the words around it.
func codeCandidates(message mailbox.FullMessage) []secret {
	text := emailAddress.ReplaceAllString(webAddress.ReplaceAllString(bodyText(message), " "), " ")
	text = spaces.ReplaceAllString(text, " ")
	seen := map[string]bool{}
	var spans [][]int
	for _, span := range codeToken.FindAllStringIndex(text, -1) {
		token := text[span[0]:span[1]]
		if seen[token] || !looksLikeCode(token) {
			continue
		}
		seen[token] = true
		spans = append(spans, span)
		if len(spans) == maxCandidates {
			break
		}
	}
	out := make([]secret, len(spans))
	for i, span := range spans {
		token := text[span[0]:span[1]]
		out[i] = secret{Value: token, Description: maskedContext(text, span[0], span[1], token, seen)}
	}
	return out
}

func looksLikeCode(token string) bool {
	plain := strings.ReplaceAll(token, "-", "")
	if n := len([]rune(plain)); n < minCodeLen || n > maxCodeLen {
		return false
	}
	digit, lower := false, false
	for _, r := range plain {
		switch {
		case unicode.IsDigit(r):
			digit = true
		case unicode.IsLower(r):
			lower = true
		}
	}
	return digit || !lower
}

// maskedContext is the text around a code with the code itself masked, every
// other candidate masked too, and a note of the code's shape so codes of
// different lengths stay apart. The window ends on whole words, so no piece of
// a code shows either.
func maskedContext(text string, start, end int, token string, candidates map[string]bool) string {
	before := []rune(text[:start])
	after := []rune(text[end:])
	if len(before) > codeContext {
		before = before[len(before)-codeContext:]
		if cut := strings.IndexRune(string(before), ' '); cut >= 0 {
			before = []rune(string(before)[cut:])
		}
	}
	if len(after) > codeContext {
		after = after[:codeContext]
		if cut := strings.LastIndex(string(after), " "); cut >= 0 {
			after = []rune(string(after)[:cut])
		}
	}
	mask := func(part string) string {
		return codeToken.ReplaceAllStringFunc(part, func(word string) string {
			if candidates[word] {
				return otherMask
			}
			return word
		})
	}
	return "…" + mask(string(before)) + codeMask + mask(string(after)) + "… (" + codeShape(token) + ")"
}

func codeShape(token string) string {
	letters, digits := 0, 0
	for _, r := range token {
		switch {
		case unicode.IsDigit(r):
			digits++
		case unicode.IsLetter(r):
			letters++
		}
	}
	shape := strings.Builder{}
	shape.WriteString(strconv.Itoa(len([]rune(token))) + " characters")
	switch {
	case letters == 0:
		shape.WriteString(", digits only")
	case digits == 0:
		shape.WriteString(", letters only")
	default:
		shape.WriteString(", letters and digits")
	}
	if strings.Contains(token, "-") {
		shape.WriteString(", with dashes")
	}
	return shape.String()
}

// linkCandidates are the web links in the email: each anchor with its text, or
// bare addresses from the plain text. Jev reads a link without its query string
// or fragment, where sites keep the token.
func linkCandidates(message mailbox.FullMessage) []secret {
	seen := map[string]bool{}
	var out []secret
	add := func(raw, text string) {
		parsed, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return
		}
		value := parsed.String()
		if seen[value] || len(out) == maxCandidates {
			return
		}
		seen[value] = true
		description := "Link to " + parsed.Host + parsed.EscapedPath()
		if text = strings.TrimSpace(spaces.ReplaceAllString(text, " ")); text != "" {
			description = "Link text \"" + text + "\" · " + description
		}
		out = append(out, secret{Value: value, Description: description})
	}
	for _, anchor := range htmlAnchors(message.HTML) {
		add(anchor.href, anchor.text)
	}
	text := bodyText(message)
	for _, span := range webAddress.FindAllStringIndex(text, -1) {
		add(text[span[0]:span[1]], lineAround(text, span[0]))
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
					current = &anchor{href: href}
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
