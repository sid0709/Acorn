package mailcode

import (
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
)

const (
	// minCodeLen and maxCodeLen bound a token that can be a one-time code.
	minCodeLen = 4
	maxCodeLen = 12
	// maxElementChars bounds the text of an element that can be a code on its own.
	maxElementChars = 32
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
	// codeElement is the text of an element or line that is only a code: up to four groups of letters
	// and digits, joined by a space or a dash. A link, an address or a sentence is not.
	codeElement = regexp.MustCompile(`^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+){0,3}$`)
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

// codeCandidates are what the email offers as its one-time code. Which is the code is the
// decision model's call, from the words around it, with the code itself masked. The first
// candidates are text that stands alone: an element (or a line of a plain email) whose whole
// text is only a code-sized run of letters and digits, which is how a site sets a code apart.
// That is a property of the email's layout, not of the code, so a code of any letters and digits
// qualifies. After them come tokens inside sentences that look like codes, for an email whose
// code is written in a line of words.
func codeCandidates(message mailbox.FullMessage) []secret {
	text := emailAddress.ReplaceAllString(webAddress.ReplaceAllString(bodyText(message), " "), " ")
	text = spaces.ReplaceAllString(text, " ")
	seen := map[string]bool{}
	var found []located
	add := func(token string, alone bool) {
		if seen[token] || len(found) == maxCandidates {
			return
		}
		seen[token] = true
		found = append(found, located{token: token, alone: alone})
	}
	for _, token := range elementTexts(message) {
		add(token, true)
	}
	for _, span := range codeToken.FindAllStringIndex(text, -1) {
		if token := text[span[0]:span[1]]; looksLikeCode(token) {
			add(token, false)
		}
	}
	out := make([]secret, len(found))
	for i, candidate := range found {
		out[i] = secret{Value: candidate.token, Description: candidateContext(text, candidate, seen)}
	}
	return out
}

// located is a candidate code and whether it stands alone in the email.
type located struct {
	token string
	alone bool
}

// candidateContext is what the decision model reads of a candidate: the words around its first
// place in the text, the candidate masked, and whether it stands alone.
func candidateContext(text string, candidate located, seen map[string]bool) string {
	note := ""
	if candidate.alone {
		note = ", standing alone in the email"
	}
	start, end := wholeWord(text, candidate.token)
	if start < 0 {
		return "…" + codeMask + "… (" + codeShape(candidate.token) + note + ")"
	}
	return maskedContext(text, start, end, candidate.token, seen, note)
}

// wholeWord is where token first stands as a word of its own in text, or -1.
func wholeWord(text, token string) (int, int) {
	for from := 0; from < len(text); {
		i := strings.Index(text[from:], token)
		if i < 0 {
			return -1, -1
		}
		start, end := from+i, from+i+len(token)
		before, _ := utf8.DecodeLastRuneInString(text[:start])
		after, _ := utf8.DecodeRuneInString(text[end:])
		if !isWordRune(before) && !isWordRune(after) {
			return start, end
		}
		from = start + 1
	}
	return -1, -1
}

func isWordRune(r rune) bool { return r != utf8.RuneError && (unicode.IsLetter(r) || unicode.IsNumber(r)) }

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

// maskedContext is the text around a code with the code itself masked, every
// other candidate masked too, and a note of the code's shape so codes of
// different lengths stay apart. The window ends on whole words, so no piece of
// a code shows either.
func maskedContext(text string, start, end int, token string, candidates map[string]bool, note string) string {
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
	return "…" + mask(string(before)) + codeMask + mask(string(after)) + "… (" + codeShape(token) + note + ")"
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
		description := "Link to " + parsed.Host + parsed.EscapedPath()
		if text = strings.TrimSpace(spaces.ReplaceAllString(text, " ")); text != "" && !webAddress.MatchString(text) {
			description = "Link text \"" + text + "\" · " + description
		}
		if before = strings.TrimSpace(spaces.ReplaceAllString(before, " ")); before != "" {
			description = "After the words \"" + before + "\" · " + description
		}
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
