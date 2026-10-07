package mailbox

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/google"
)

// fakeGoogle answers token, userinfo, and Gmail API calls in memory.
type fakeGoogle struct {
	mu       sync.Mutex
	calls    map[string]int
	refresh  atomic.Int32
	handlers map[string]any
}

func (f *fakeGoogle) RoundTrip(req *http.Request) (*http.Response, error) {
	path := req.URL.Host + req.URL.Path
	f.mu.Lock()
	if f.calls == nil {
		f.calls = map[string]int{}
	}
	f.calls[path]++
	f.mu.Unlock()
	var body any
	switch {
	case req.URL.Host == "oauth2.googleapis.com":
		f.refresh.Add(1)
		body = map[string]any{"access_token": "access", "expires_in": 3600}
	default:
		value, ok := f.handlers[path]
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("{}")), Header: http.Header{}}, nil
		}
		body = value
	}
	raw, _ := json.Marshal(body)
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(raw))), Header: http.Header{}}, nil
}

func (f *fakeGoogle) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[path]
}

func newFakeGoogle(handlers map[string]any) (*Google, *fakeGoogle) {
	fake := &fakeGoogle{handlers: handlers}
	return &Google{
		OAuth:       &google.Client{ClientID: "id", ClientSecret: "secret", HTTP: &http.Client{Transport: fake}},
		RedirectURL: "https://example.test/callback",
	}, fake
}

const gmailHost = "gmail.googleapis.com/gmail/v1/users/me"

func b64(value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

func TestListMessagesKeepsOrderAndCaches(t *testing.T) {
	row := func(id, from, subject string, labels ...string) map[string]any {
		return map[string]any{
			"id": id, "threadId": "t" + id, "labelIds": labels, "snippet": "Hi &amp; welcome",
			"internalDate": "1759831680000",
			"payload": map[string]any{"headers": []map[string]string{
				{"name": "From", "value": from}, {"name": "Subject", "value": subject},
			}},
		}
	}
	g, fake := newFakeGoogle(map[string]any{
		gmailHost + "/messages": map[string]any{
			"messages":           []map[string]string{{"id": "a"}, {"id": "b"}, {"id": "c"}},
			"nextPageToken":      "next",
			"resultSizeEstimate": 120,
		},
		gmailHost + "/messages/a": row("a", `"Mux Hiring Team" <no-reply@ashbyhq.com>`, "=?UTF-8?Q?Thank_you?=", "INBOX", "UNREAD"),
		gmailHost + "/messages/b": row("b", "jobs@example.com", "Second", "INBOX", "Label_1"),
		gmailHost + "/messages/c": row("c", "Ann <ann@example.com>", "Third", "INBOX"),
	})
	ctx := context.Background()
	page, err := g.ListMessages(ctx, "box", "refresh", ListQuery{LabelID: "INBOX"})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 3 || page.NextPageToken != "next" || page.ResultSizeEstimate != 120 {
		t.Fatalf("page = %+v", page)
	}
	first := page.Messages[0]
	if first.ID != "a" || first.Sender != "Mux Hiring Team" || first.SenderEmail != "no-reply@ashbyhq.com" {
		t.Fatalf("first = %+v", first)
	}
	if first.Subject != "Thank you" || first.Snippet != "Hi & welcome" {
		t.Fatalf("decoded subject/snippet = %q / %q", first.Subject, first.Snippet)
	}
	if page.Messages[1].ID != "b" || page.Messages[2].ID != "c" {
		t.Fatalf("order = %v %v", page.Messages[1].ID, page.Messages[2].ID)
	}
	if _, err := g.ListMessages(ctx, "box", "refresh", ListQuery{LabelID: "INBOX"}); err != nil {
		t.Fatal(err)
	}
	if got := fake.count(gmailHost + "/messages"); got != 1 {
		t.Fatalf("list calls = %d, want 1 (second page read is cached)", got)
	}
	if got := fake.refresh.Load(); got != 1 {
		t.Fatalf("token refreshes = %d, want 1", got)
	}
	if _, err := g.ListMessages(ctx, "box", "refresh", ListQuery{LabelID: "INBOX", Fresh: true}); err != nil {
		t.Fatal(err)
	}
	if got := fake.count(gmailHost + "/messages/a"); got != 2 {
		t.Fatalf("row reads after refresh = %d, want 2", got)
	}
}

func TestListMessagesSkipsDeletedRows(t *testing.T) {
	g, _ := newFakeGoogle(map[string]any{
		gmailHost + "/messages": map[string]any{"messages": []map[string]string{{"id": "gone"}, {"id": "kept"}}},
		gmailHost + "/messages/kept": map[string]any{
			"id": "kept", "internalDate": "1759831680000",
			"payload": map[string]any{"headers": []map[string]string{{"name": "Subject", "value": "Here"}}},
		},
	})
	page, err := g.ListMessages(context.Background(), "box", "refresh", ListQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 1 || page.Messages[0].ID != "kept" {
		t.Fatalf("messages = %+v", page.Messages)
	}
}

func TestMessageReadsHTMLInlinesImagesAndListsFiles(t *testing.T) {
	latin1HTML := "<p>Caf\xe9 <img src=\"cid:logo@mail\"></p>"
	g, _ := newFakeGoogle(map[string]any{
		gmailHost + "/messages/m1": map[string]any{
			"id": "m1", "threadId": "t1", "labelIds": []string{"INBOX", "UNREAD"}, "internalDate": "1759831680000",
			"payload": map[string]any{
				"mimeType": "multipart/mixed",
				"headers": []map[string]string{
					{"name": "From", "value": "Recruiter <r@example.com>"},
					{"name": "To", "value": "me@example.com"},
					{"name": "Subject", "value": "Offer"},
				},
				"parts": []any{
					map[string]any{
						"mimeType": "multipart/alternative",
						"parts": []any{
							map[string]any{"mimeType": "text/plain", "body": map[string]any{"data": b64("Cafe")}},
							map[string]any{
								"mimeType": "multipart/related",
								"parts": []any{
									map[string]any{
										"mimeType": "text/html",
										"headers":  []map[string]string{{"name": "Content-Type", "value": "text/html; charset=ISO-8859-1"}},
										"body":     map[string]any{"data": b64(latin1HTML)},
									},
									map[string]any{
										"mimeType": "image/png",
										"headers":  []map[string]string{{"name": "Content-ID", "value": "<logo@mail>"}},
										"body":     map[string]any{"attachmentId": "img1", "size": 3},
									},
								},
							},
						},
					},
					map[string]any{
						"mimeType": "application/pdf", "filename": "offer.pdf",
						"headers": []map[string]string{{"name": "Content-Disposition", "value": "attachment"}},
						"body":    map[string]any{"attachmentId": "pdf1", "size": 2048},
					},
				},
			},
		},
		gmailHost + "/messages/m1/attachments/img1": map[string]any{"data": b64("png")},
	})
	msg, err := g.Message(context.Background(), "box", "refresh", "m1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg.HTML, "Café") {
		t.Fatalf("html charset not decoded: %q", msg.HTML)
	}
	if !strings.Contains(msg.HTML, "data:image/png;base64,"+base64.StdEncoding.EncodeToString([]byte("png"))) {
		t.Fatalf("inline image not folded in: %q", msg.HTML)
	}
	if msg.Text != "" {
		t.Fatalf("text alternative should give way to html, got %q", msg.Text)
	}
	if len(msg.Attachments) != 1 || msg.Attachments[0].Filename != "offer.pdf" || msg.Attachments[0].Size != 2048 {
		t.Fatalf("attachments = %+v", msg.Attachments)
	}
	if msg.From.Name != "Recruiter" || msg.To != "me@example.com" {
		t.Fatalf("headers = %+v", msg)
	}
}

func TestMessageNotFound(t *testing.T) {
	g, _ := newFakeGoogle(map[string]any{})
	if _, err := g.Message(context.Background(), "box", "refresh", "missing"); err != ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestOverviewOrdersLabelsAndHidesHidden(t *testing.T) {
	g, _ := newFakeGoogle(map[string]any{
		gmailHost + "/labels": map[string]any{"labels": []map[string]any{
			{"id": "SENT", "name": "SENT", "type": "system"},
			{"id": "CATEGORY_UPDATES", "name": "CATEGORY_UPDATES", "type": "system"},
			{"id": "INBOX", "name": "INBOX", "type": "system"},
			{"id": "Label_2", "name": "zeta", "type": "user"},
			{"id": "Label_1", "name": "Jobs", "type": "user", "color": map[string]string{"backgroundColor": "#4a86e8"}},
			{"id": "Label_3", "name": "Hidden", "type": "user", "labelListVisibility": "labelHide"},
		}},
		gmailHost + "/labels/INBOX":   map[string]any{"messagesTotal": 120, "messagesUnread": 48},
		gmailHost + "/labels/SENT":    map[string]any{"messagesTotal": 10},
		gmailHost + "/labels/Label_1": map[string]any{"messagesTotal": 5, "messagesUnread": 2},
		gmailHost + "/labels/Label_2": map[string]any{"messagesTotal": 1},
		"openidconnect.googleapis.com/v1/userinfo": map[string]any{
			"email": "Stan@Gmail.com", "name": "Stanley Wang", "picture": "https://example.test/me.png",
		},
	})
	overview, err := g.Overview(context.Background(), "box", "refresh", false)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, label := range overview.Labels {
		ids = append(ids, label.ID)
	}
	if strings.Join(ids, ",") != "INBOX,SENT,Label_1,Label_2" {
		t.Fatalf("label order = %v", ids)
	}
	if overview.Labels[0].Unread != 48 || overview.Labels[0].Total != 120 {
		t.Fatalf("inbox counts = %+v", overview.Labels[0])
	}
	if overview.Labels[2].Color != "blue" {
		t.Fatalf("Jobs color = %q, want blue", overview.Labels[2].Color)
	}
	if overview.Profile.Name != "Stanley Wang" || overview.Profile.Email != "stan@gmail.com" || overview.Profile.Picture == "" {
		t.Fatalf("profile = %+v", overview.Profile)
	}
}

func TestColorFamily(t *testing.T) {
	cases := map[string]string{
		"#fb4c2f": "red",
		"#ffad47": "orange",
		"#fad165": "yellow",
		"#16a766": "green",
		"#4a86e8": "blue",
		"#a479e2": "purple",
		"#f691b3": "pink",
		"#cccccc": "neutral",
		"":        "",
		"#zzzzzz": "",
	}
	for hex, want := range cases {
		if got := colorFamily(hex); got != want {
			t.Errorf("colorFamily(%q) = %q, want %q", hex, got, want)
		}
	}
}
