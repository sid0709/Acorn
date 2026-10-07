package mailbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"mime"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
)

const (
	DefaultPageSize = 25
	MaxPageSize     = 100
	// rowConcurrency is how many message reads run at once. Gmail allows about 250
	// quota units per user per second and a metadata read costs 5.
	rowConcurrency = 10
	rowCacheTTL    = time.Minute
	maxCachedRows  = 20000
	pageCacheTTL   = 20 * time.Second
	maxCachedPages = 2000
	// LabelUnread marks unread mail in Gmail.
	LabelUnread = "UNREAD"
)

// Message is one inbox row for the Acorn Gmail view.
type Message struct {
	ID          string
	ThreadID    string
	Sender      string
	SenderEmail string
	Subject     string
	Snippet     string
	LabelIDs    []string
	ReceivedAt  time.Time
}

// Page is one page of a Gmail listing. NextPageToken is empty on the last page.
type Page struct {
	Messages           []Message
	NextPageToken      string
	ResultSizeEstimate int
}

// ListQuery picks what to list: a label (empty means all mail), Gmail search
// syntax, and the cursor Google returned for the previous page.
type ListQuery struct {
	LabelID   string
	Query     string
	PageToken string
	PageSize  int
	// Fresh skips cached pages and rows, for an explicit refresh.
	Fresh bool
}

// ListMessages reads one page: a single list call, then every row's headers in
// parallel. Rows and pages read in the last few seconds come from memory.
func (g *Google) ListMessages(ctx context.Context, mailboxID, refreshToken string, query ListQuery) (Page, error) {
	g.init()
	if query.PageSize <= 0 {
		query.PageSize = DefaultPageSize
	}
	query.PageSize = min(query.PageSize, MaxPageSize)
	pageKey := strings.Join([]string{mailboxID, query.LabelID, query.Query, query.PageToken, strconv.Itoa(query.PageSize)}, "\x00")
	if !query.Fresh {
		if page, ok := g.pages.get(pageKey, time.Now()); ok {
			return page, nil
		}
	}
	// The server render and the browser can ask for the same page at once; read it once.
	value, err, _ := g.inflight.Do(pageKey, func() (any, error) {
		return g.readPage(ctx, mailboxID, refreshToken, pageKey, query)
	})
	if err != nil {
		return Page{}, err
	}
	return value.(Page), nil
}

func (g *Google) readPage(ctx context.Context, mailboxID, refreshToken, pageKey string, query ListQuery) (Page, error) {
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return Page{}, err
	}
	params := url.Values{
		"maxResults": {strconv.Itoa(query.PageSize)},
		"fields":     {"messages/id,nextPageToken,resultSizeEstimate"},
	}
	if query.LabelID != "" {
		params.Set("labelIds", query.LabelID)
	}
	if query.Query != "" {
		params.Set("q", query.Query)
	}
	if query.PageToken != "" {
		params.Set("pageToken", query.PageToken)
	}
	body, err := g.get(ctx, access, "/messages", params)
	if err != nil {
		return Page{}, fmt.Errorf("list gmail messages: %w", err)
	}
	var listed struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
		NextPageToken      string `json:"nextPageToken"`
		ResultSizeEstimate int    `json:"resultSizeEstimate"`
	}
	if err := json.Unmarshal(body, &listed); err != nil {
		return Page{}, fmt.Errorf("decode gmail list: %w", err)
	}

	rows := make([]Message, len(listed.Messages))
	found := make([]bool, len(listed.Messages))
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(rowConcurrency)
	for i, row := range listed.Messages {
		rowKey := mailboxID + "\x00" + row.ID
		if !query.Fresh {
			if cached, ok := g.rows.get(rowKey, time.Now()); ok {
				rows[i], found[i] = cached, true
				continue
			}
		}
		group.Go(func() error {
			msg, err := g.loadRow(groupCtx, access, row.ID)
			if errors.Is(err, errGmailGone) {
				return nil
			}
			if err != nil {
				return err
			}
			g.rows.set(rowKey, msg, time.Now())
			rows[i], found[i] = msg, true
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return Page{}, fmt.Errorf("read gmail rows: %w", err)
	}
	page := Page{
		Messages:           make([]Message, 0, len(rows)),
		NextPageToken:      listed.NextPageToken,
		ResultSizeEstimate: listed.ResultSizeEstimate,
	}
	for i, row := range rows {
		if found[i] {
			page.Messages = append(page.Messages, row)
		}
	}
	g.pages.set(pageKey, page, time.Now())
	return page, nil
}

// errGmailGone is a message deleted between the list call and the row read.
var errGmailGone = errors.New("gmail message is gone")

func (g *Google) loadRow(ctx context.Context, access, id string) (Message, error) {
	params := url.Values{
		"format":          {"metadata"},
		"metadataHeaders": {"From", "Subject"},
		"fields":          {"id,threadId,labelIds,snippet,internalDate,payload/headers"},
	}
	body, err := g.get(ctx, access, "/messages/"+url.PathEscape(id), params)
	if err != nil {
		if isNotFound(err) {
			return Message{}, errGmailGone
		}
		return Message{}, err
	}
	var raw struct {
		ID           string   `json:"id"`
		ThreadID     string   `json:"threadId"`
		LabelIDs     []string `json:"labelIds"`
		Snippet      string   `json:"snippet"`
		InternalDate string   `json:"internalDate"`
		Payload      struct {
			Headers []gmailHeader `json:"headers"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return Message{}, fmt.Errorf("decode gmail message: %w", err)
	}
	sender, senderEmail := parseFrom(headerValue(raw.Payload.Headers, "From"))
	return Message{
		ID:          raw.ID,
		ThreadID:    raw.ThreadID,
		Sender:      sender,
		SenderEmail: senderEmail,
		Subject:     headerValue(raw.Payload.Headers, "Subject"),
		Snippet:     strings.TrimSpace(html.UnescapeString(raw.Snippet)),
		LabelIDs:    raw.LabelIDs,
		ReceivedAt:  parseInternalDate(raw.InternalDate),
	}, nil
}

type gmailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

var headerDecoder = mime.WordDecoder{CharsetReader: charsetReader}

// headerValue returns a header with any RFC 2047 encoded words decoded.
func headerValue(headers []gmailHeader, name string) string {
	for _, header := range headers {
		if strings.EqualFold(header.Name, name) {
			value := strings.TrimSpace(header.Value)
			if decoded, err := headerDecoder.DecodeHeader(value); err == nil {
				return decoded
			}
			return value
		}
	}
	return ""
}

func parseInternalDate(raw string) time.Time {
	ms, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return time.Now().UTC()
	}
	return time.UnixMilli(ms).UTC()
}

func parseFrom(raw string) (name, email string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "Unknown", ""
	}
	if start := strings.LastIndex(raw, "<"); start >= 0 {
		end := strings.Index(raw[start:], ">")
		if end > 0 {
			email = strings.TrimSpace(raw[start+1 : start+end])
			name = strings.TrimSpace(strings.Trim(strings.TrimSpace(raw[:start]), `"'`))
			if name == "" {
				name = email
			}
			return name, strings.ToLower(email)
		}
	}
	if strings.Contains(raw, "@") {
		return raw, strings.ToLower(raw)
	}
	return raw, ""
}
