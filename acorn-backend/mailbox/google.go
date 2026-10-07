package mailbox

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/google"
)

const (
	gmailAPIBase   = "https://gmail.googleapis.com/gmail/v1"
	defaultInboxLimit = 50
)

// Google reads a job hunter's Gmail through the shared OAuth client.
type Google struct {
	OAuth       *google.Client
	RedirectURL string
}

func (g *Google) Configured() bool {
	return g != nil && g.OAuth.Configured() && g.RedirectURL != ""
}

var gmailScopes = []string{google.ScopeOpenID, google.ScopeEmail, google.ScopeGmailReadonly}

func (g *Google) AuthURL(state, loginHint, codeChallenge string) string {
	return g.OAuth.AuthURL(google.AuthRequest{
		RedirectURL:   g.RedirectURL,
		Scopes:        gmailScopes,
		State:         state,
		CodeChallenge: codeChallenge,
		Offline:       true,
		Consent:       true,
		LoginHint:     loginHint,
	})
}

func (g *Google) Exchange(ctx context.Context, code, redirect, verifier string) (GoogleGrant, error) {
	token, err := g.OAuth.Exchange(ctx, code, redirect, verifier)
	if err != nil {
		return GoogleGrant{}, err
	}
	if !token.Granted(google.ScopeGmailReadonly) {
		return GoogleGrant{}, fmt.Errorf("gmail readonly scope was not granted")
	}
	profile, err := g.OAuth.Profile(ctx, token.AccessToken)
	if err != nil {
		return GoogleGrant{}, err
	}
	return GoogleGrant{
		Subject:      profile.Subject,
		Email:        profile.Email,
		RefreshToken: token.RefreshToken,
	}, nil
}

// Message is one inbox row for the Acorn Gmail view.
type Message struct {
	ID          string
	Sender      string
	SenderEmail string
	Subject     string
	Snippet     string
	Body        []string
	ReceivedOn  string
	ReceivedAt  int
}

func (g *Google) ListInbox(ctx context.Context, refreshToken string, limit int) ([]Message, error) {
	if limit <= 0 || limit > defaultInboxLimit {
		limit = defaultInboxLimit
	}
	access, err := g.OAuth.AccessToken(ctx, refreshToken)
	if err != nil {
		return nil, err
	}
	listURL, err := url.Parse(gmailAPIBase + "/users/me/messages")
	if err != nil {
		return nil, err
	}
	query := listURL.Query()
	query.Set("maxResults", fmt.Sprintf("%d", limit))
	query.Set("labelIds", "INBOX")
	listURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	body, status, err := g.do(req)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("gmail list: status %d", status)
	}
	var listed struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &listed); err != nil {
		return nil, err
	}
	out := make([]Message, 0, len(listed.Messages))
	for _, row := range listed.Messages {
		if row.ID == "" {
			continue
		}
		msg, err := g.loadMessage(ctx, access, row.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, msg)
	}
	return out, nil
}

func (g *Google) loadMessage(ctx context.Context, accessToken, id string) (Message, error) {
	endpoint := gmailAPIBase + "/users/me/messages/" + url.PathEscape(id)
	reqURL, err := url.Parse(endpoint)
	if err != nil {
		return Message{}, err
	}
	query := reqURL.Query()
	query.Set("format", "metadata")
	query.Set("metadataHeaders", "From")
	query.Add("metadataHeaders", "Subject")
	query.Add("metadataHeaders", "Date")
	reqURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL.String(), nil)
	if err != nil {
		return Message{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	body, status, err := g.do(req)
	if err != nil {
		return Message{}, err
	}
	if status >= 300 {
		return Message{}, fmt.Errorf("gmail message: status %d", status)
	}
	var raw struct {
		ID           string `json:"id"`
		Snippet      string `json:"snippet"`
		InternalDate string `json:"internalDate"`
		Payload      struct {
			Headers []gmailHeader `json:"headers"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return Message{}, err
	}
	from := headerValue(raw.Payload.Headers, "From")
	subject := headerValue(raw.Payload.Headers, "Subject")
	when := parseInternalDate(raw.InternalDate)
	sender, senderEmail := parseFrom(from)
	snippet := strings.TrimSpace(raw.Snippet)
	paragraphs := []string{snippet}
	if snippet == "" {
		paragraphs = []string{"(No preview)"}
	}
	return Message{
		ID:          raw.ID,
		Sender:      sender,
		SenderEmail: senderEmail,
		Subject:     subject,
		Snippet:     snippet,
		Body:        paragraphs,
		ReceivedOn:  when.Format("2006-01-02"),
		ReceivedAt:  when.Hour()*60 + when.Minute(),
	}, nil
}

func (g *Google) do(req *http.Request) ([]byte, int, error) {
	res, err := g.OAuth.HTTPClient().Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	body, err := google.ReadBody(res)
	if err != nil {
		return nil, 0, err
	}
	return body, res.StatusCode, nil
}

type gmailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

func headerValue(headers []gmailHeader, name string) string {
	for _, header := range headers {
		if strings.EqualFold(header.Name, name) {
			return strings.TrimSpace(header.Value)
		}
	}
	return ""
}

func parseInternalDate(raw string) time.Time {
	ms, err := json.Number(raw).Int64()
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
			name = strings.TrimSpace(strings.Trim(raw[:start], `"`))
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

// DecodeBody decodes a Gmail API base64url body chunk (exported for tests).
func DecodeBody(encoded string) string {
	if encoded == "" {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	return string(raw)
}
