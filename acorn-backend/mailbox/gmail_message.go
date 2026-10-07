package mailbox

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/url"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
	"golang.org/x/text/encoding/htmlindex"
)

const (
	messageCacheTTL   = 10 * time.Minute
	maxCachedMessages = 500
	// maxInlineImage and maxInlineTotal bound the cid: images folded into the HTML.
	maxInlineImage    = 2 << 20
	maxInlineTotal    = 8 << 20
	inlineConcurrency = 4
)

// Address is one sender or recipient.
type Address struct {
	Name  string
	Email string
}

// Attachment is a file on a message. Inline images are folded into HTML instead.
type Attachment struct {
	Filename string
	MimeType string
	Size     int
}

// FullMessage is one message as the reader shows it.
type FullMessage struct {
	ID          string
	ThreadID    string
	Subject     string
	From        Address
	To          string
	Cc          string
	ReplyTo     string
	LabelIDs    []string
	ReceivedAt  time.Time
	HTML        string
	Text        string
	Attachments []Attachment
}

type gmailPart struct {
	MimeType string        `json:"mimeType"`
	Filename string        `json:"filename"`
	Headers  []gmailHeader `json:"headers"`
	Body     struct {
		AttachmentID string `json:"attachmentId"`
		Size         int    `json:"size"`
		Data         string `json:"data"`
	} `json:"body"`
	Parts []gmailPart `json:"parts"`
}

// Message reads one full message: its HTML (or text) body, headers, labels, and
// attachments. Bodies never change, so a read stays cached for a while.
func (g *Google) Message(ctx context.Context, mailboxID, refreshToken, id string) (FullMessage, error) {
	g.init()
	key := mailboxID + "\x00" + id
	if cached, ok := g.messages.get(key, time.Now()); ok {
		return cached, nil
	}
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return FullMessage{}, err
	}
	path := "/messages/" + url.PathEscape(id)
	body, err := g.get(ctx, access, path, url.Values{"format": {"full"}})
	if isNotFound(err) {
		return FullMessage{}, ErrNotFound
	}
	if err != nil {
		return FullMessage{}, fmt.Errorf("read gmail message: %w", err)
	}
	var raw struct {
		ID           string    `json:"id"`
		ThreadID     string    `json:"threadId"`
		LabelIDs     []string  `json:"labelIds"`
		InternalDate string    `json:"internalDate"`
		Payload      gmailPart `json:"payload"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return FullMessage{}, fmt.Errorf("decode gmail message: %w", err)
	}
	headers := raw.Payload.Headers
	name, email := parseFrom(headerValue(headers, "From"))
	msg := FullMessage{
		ID:         raw.ID,
		ThreadID:   raw.ThreadID,
		Subject:    headerValue(headers, "Subject"),
		From:       Address{Name: name, Email: email},
		To:         headerValue(headers, "To"),
		Cc:         headerValue(headers, "Cc"),
		ReplyTo:    headerValue(headers, "Reply-To"),
		LabelIDs:   raw.LabelIDs,
		ReceivedAt: parseInternalDate(raw.InternalDate),
	}

	var walk bodyWalk
	walk.visit(raw.Payload)
	if err := g.loadBodies(ctx, access, path, &walk); err != nil {
		return FullMessage{}, err
	}
	msg.HTML = strings.Join(walk.html, "\n")
	msg.Text = strings.Join(walk.text, "\n\n")
	msg.HTML = g.inlineImages(ctx, access, path, msg.HTML, walk.inline)
	for _, part := range walk.files {
		msg.Attachments = append(msg.Attachments, Attachment{Filename: part.Filename, MimeType: part.MimeType, Size: part.Body.Size})
	}
	g.messages.set(key, msg, time.Now())
	return msg, nil
}

// bodyWalk sorts a message's MIME tree into readable bodies, inline images, and files.
type bodyWalk struct {
	htmlParts []gmailPart
	textParts []gmailPart
	html      []string
	text      []string
	inline    map[string]gmailPart
	files     []gmailPart
}

func (w *bodyWalk) visit(part gmailPart) {
	mimeType := strings.ToLower(part.MimeType)
	disposition := strings.ToLower(headerValue(part.Headers, "Content-Disposition"))
	contentID := strings.Trim(headerValue(part.Headers, "Content-ID"), "<> ")
	switch {
	case strings.HasPrefix(mimeType, "multipart/alternative"):
		// Alternatives say the same thing; keep the richest one Gmail would show.
		if html := findPart(part, "text/html"); html != nil {
			w.visit(*html)
			w.visitInline(part)
			return
		}
		for _, child := range part.Parts {
			w.visit(child)
		}
	case strings.HasPrefix(mimeType, "multipart/"):
		for _, child := range part.Parts {
			w.visit(child)
		}
	case contentID != "" && strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(disposition, "attachment"):
		if w.inline == nil {
			w.inline = map[string]gmailPart{}
		}
		w.inline[contentID] = part
	case part.Filename != "" || strings.HasPrefix(disposition, "attachment"):
		w.files = append(w.files, part)
	case mimeType == "text/html":
		w.htmlParts = append(w.htmlParts, part)
	case mimeType == "text/plain":
		w.textParts = append(w.textParts, part)
	}
}

// visitInline collects images related to an HTML alternative (multipart/related inside it).
func (w *bodyWalk) visitInline(part gmailPart) {
	for _, child := range part.Parts {
		if strings.HasPrefix(strings.ToLower(child.MimeType), "multipart/") {
			for _, grandchild := range child.Parts {
				if !strings.EqualFold(grandchild.MimeType, "text/html") {
					w.visit(grandchild)
				}
			}
		}
	}
}

// findPart is the first part of mimeType under part, depth first.
func findPart(part gmailPart, mimeType string) *gmailPart {
	if strings.EqualFold(part.MimeType, mimeType) {
		return &part
	}
	for _, child := range part.Parts {
		if found := findPart(child, mimeType); found != nil {
			return found
		}
	}
	return nil
}

// loadBodies decodes the text bodies, fetching any Gmail stored as attachments.
func (g *Google) loadBodies(ctx context.Context, access, path string, w *bodyWalk) error {
	decode := func(parts []gmailPart) ([]string, error) {
		out := make([]string, len(parts))
		group, groupCtx := errgroup.WithContext(ctx)
		group.SetLimit(inlineConcurrency)
		for i, part := range parts {
			group.Go(func() error {
				data, err := g.partData(groupCtx, access, path, part)
				if err != nil {
					return err
				}
				out[i] = toUTF8(data, part)
				return nil
			})
		}
		return out, group.Wait()
	}
	var err error
	if w.html, err = decode(w.htmlParts); err != nil {
		return fmt.Errorf("read gmail html body: %w", err)
	}
	if w.text, err = decode(w.textParts); err != nil {
		return fmt.Errorf("read gmail text body: %w", err)
	}
	return nil
}

// inlineImages swaps cid: references for data URLs so the HTML renders on its own.
func (g *Google) inlineImages(ctx context.Context, access, path, html string, inline map[string]gmailPart) string {
	if html == "" || len(inline) == 0 {
		return html
	}
	type image struct {
		cid  string
		part gmailPart
		uri  string
	}
	var images []*image
	total := 0
	for cid, part := range inline {
		if !strings.Contains(html, "cid:"+cid) || part.Body.Size > maxInlineImage || total+part.Body.Size > maxInlineTotal {
			continue
		}
		total += part.Body.Size
		images = append(images, &image{cid: cid, part: part})
	}
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(inlineConcurrency)
	for _, img := range images {
		group.Go(func() error {
			data, err := g.partData(groupCtx, access, path, img.part)
			if err != nil {
				return nil // A missing image should not hide the message.
			}
			img.uri = "data:" + img.part.MimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
			return nil
		})
	}
	_ = group.Wait()
	for _, img := range images {
		if img.uri != "" {
			html = strings.ReplaceAll(html, "cid:"+img.cid, img.uri)
		}
	}
	return html
}

// partData is a part's decoded bytes, from the message or its attachment endpoint.
func (g *Google) partData(ctx context.Context, access, path string, part gmailPart) ([]byte, error) {
	encoded := part.Body.Data
	if encoded == "" && part.Body.AttachmentID != "" {
		body, err := g.get(ctx, access, path+"/attachments/"+url.PathEscape(part.Body.AttachmentID), nil)
		if err != nil {
			return nil, err
		}
		var attachment struct {
			Data string `json:"data"`
		}
		if err := json.Unmarshal(body, &attachment); err != nil {
			return nil, fmt.Errorf("decode gmail attachment: %w", err)
		}
		encoded = attachment.Data
	}
	return DecodeBody(encoded)
}

// DecodeBody decodes a Gmail API base64url body chunk, padded or not.
func DecodeBody(encoded string) ([]byte, error) {
	if encoded == "" {
		return nil, nil
	}
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(encoded, "="))
}

// toUTF8 converts a body from the charset its Content-Type names.
func toUTF8(data []byte, part gmailPart) string {
	_, params, err := mime.ParseMediaType(headerValue(part.Headers, "Content-Type"))
	if err != nil {
		return string(data)
	}
	reader, err := charsetReader(params["charset"], bytes.NewReader(data))
	if err != nil {
		return string(data)
	}
	converted, err := io.ReadAll(reader)
	if err != nil {
		return string(data)
	}
	return string(converted)
}

// charsetReader decodes any charset the WHATWG encoding index knows.
func charsetReader(charset string, input io.Reader) (io.Reader, error) {
	charset = strings.ToLower(strings.TrimSpace(charset))
	if charset == "" || charset == "utf-8" || charset == "us-ascii" {
		return input, nil
	}
	encoding, err := htmlindex.Get(charset)
	if err != nil {
		return nil, fmt.Errorf("unknown charset %q: %w", charset, err)
	}
	return encoding.NewDecoder().Reader(input), nil
}
