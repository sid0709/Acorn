package mailbox

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/google"
	"golang.org/x/sync/singleflight"
)

const (
	gmailAPIBase = "https://gmail.googleapis.com/gmail/v1/users/me"
	// accessTokenMargin refreshes an access token this long before Google expires it.
	accessTokenMargin = time.Minute
	// fallbackTokenLifetime is used when Google omits expires_in.
	fallbackTokenLifetime = 30 * time.Minute
	maxCachedTokens       = 512
	// maxGmailBody caps one Gmail API reply; full HTML messages can be large.
	maxGmailBody = 16 << 20
	// gmailRetries is how many times a rate-limited Gmail call is retried.
	gmailRetries   = 3
	gmailRetryBase = 200 * time.Millisecond
)

// ErrGmailAuth is a refresh token Google no longer accepts; the mailbox must reconnect.
var ErrGmailAuth = errors.New("Gmail access was revoked; reconnect this mailbox")

// Google reads a job hunter's Gmail through the shared OAuth client. It keeps
// access tokens and recent reads in memory so a page of mail costs one round
// of parallel Gmail calls instead of a token refresh plus one call per row.
type Google struct {
	OAuth       *google.Client
	RedirectURL string

	once     sync.Once
	tokens   *ttlCache[string]
	refresh  singleflight.Group
	inflight singleflight.Group
	rows     *ttlCache[Message]
	pages    *ttlCache[Page]
	labels   *ttlCache[Overview]
	messages *ttlCache[FullMessage]
}

func (g *Google) init() {
	g.once.Do(func() {
		g.tokens = newTTLCache[string](fallbackTokenLifetime, maxCachedTokens)
		g.rows = newTTLCache[Message](rowCacheTTL, maxCachedRows)
		g.pages = newTTLCache[Page](pageCacheTTL, maxCachedPages)
		g.labels = newTTLCache[Overview](overviewCacheTTL, maxCachedOverviews)
		g.messages = newTTLCache[FullMessage](messageCacheTTL, maxCachedMessages)
	})
}

func (g *Google) Configured() bool {
	return g != nil && g.OAuth.Configured() && g.RedirectURL != ""
}

var gmailScopes = []string{google.ScopeOpenID, google.ScopeEmail, google.ScopeProfile, google.ScopeGmailReadonly}

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
		Name:         profile.Name,
		Picture:      profile.Picture,
		RefreshToken: token.RefreshToken,
	}, nil
}

// accessToken returns a cached access token for refreshToken, refreshing it at
// most once at a time no matter how many requests ask together.
func (g *Google) accessToken(ctx context.Context, refreshToken string) (string, error) {
	g.init()
	key := tokenKey(refreshToken)
	if token, ok := g.tokens.get(key, time.Now()); ok {
		return token, nil
	}
	value, err, _ := g.refresh.Do(key, func() (any, error) {
		if token, ok := g.tokens.get(key, time.Now()); ok {
			return token, nil
		}
		token, err := g.OAuth.Refresh(ctx, refreshToken)
		if errors.Is(err, google.ErrInvalidGrant) {
			return "", ErrGmailAuth
		}
		if err != nil {
			return "", fmt.Errorf("refresh gmail token: %w", err)
		}
		lifetime := fallbackTokenLifetime
		if token.ExpiresIn > 0 {
			lifetime = time.Duration(token.ExpiresIn) * time.Second
		}
		g.tokens.setFor(key, token.AccessToken, time.Now(), lifetime-accessTokenMargin)
		return token.AccessToken, nil
	})
	if err != nil {
		return "", err
	}
	return value.(string), nil
}

// tokenKey keeps raw refresh tokens out of map keys.
func tokenKey(refreshToken string) string {
	sum := sha256.Sum256([]byte(refreshToken))
	return hex.EncodeToString(sum[:])
}

// get calls a Gmail endpoint (relative to gmailAPIBase) and returns the body.
func (g *Google) get(ctx context.Context, accessToken, path string, query url.Values) ([]byte, error) {
	endpoint := gmailAPIBase + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		body, status, err := g.do(req)
		if err != nil {
			return nil, err
		}
		if status < 300 {
			return body, nil
		}
		if status == http.StatusUnauthorized {
			return nil, ErrGmailAuth
		}
		if retryable(status, body) && attempt < gmailRetries {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(gmailRetryBase << attempt):
			}
			continue
		}
		return nil, &gmailStatusError{path: path, status: status}
	}
}

// retryable is a rate limit or a server hiccup. Gmail answers per-user rate
// limits with 403 too, so a 403 only retries when it names one.
func retryable(status int, body []byte) bool {
	switch {
	case status == http.StatusTooManyRequests || status >= http.StatusInternalServerError:
		return true
	case status == http.StatusForbidden:
		return bytes.Contains(body, []byte("RateLimitExceeded")) || bytes.Contains(body, []byte("rateLimitExceeded"))
	}
	return false
}

// gmailStatusError is a Gmail reply that was not a success.
type gmailStatusError struct {
	path   string
	status int
}

func (e *gmailStatusError) Error() string {
	return fmt.Sprintf("gmail %s: status %d", e.path, e.status)
}

func isNotFound(err error) bool {
	var status *gmailStatusError
	return errors.As(err, &status) && status.status == http.StatusNotFound
}

func (g *Google) do(req *http.Request) ([]byte, int, error) {
	res, err := g.OAuth.HTTPClient().Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	// The transport asks for gzip and inflates it, so replies cross the wire compressed.
	body, err := io.ReadAll(io.LimitReader(res.Body, maxGmailBody))
	if err != nil {
		return nil, 0, err
	}
	return body, res.StatusCode, nil
}
