package mailwatch

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/acorn/acorn-backend/config"
)

const (
	// certsTTL is how long Google's signing keys are kept before they are read again.
	certsTTL = time.Hour
	// certsRefetchGap is the shortest wait between two reads of the keys, so a token signed with a
	// key Google never published cannot make this server fetch them on every call.
	certsRefetchGap = time.Minute
	certsTimeout    = 10 * time.Second
	maxCertsBody    = 1 << 20
	// tokenLeeway is the clock difference allowed when a token's expiry is checked.
	tokenLeeway = time.Minute
	rs256       = "RS256"
)

// ErrUnauthorized is a push call that does not carry Google's token for the configured subscription.
var ErrUnauthorized = errors.New("push call is not authorized")

var googleIssuers = map[string]bool{"https://accounts.google.com": true, "accounts.google.com": true}

// verifier checks the OIDC token a Pub/Sub push subscription signs each call with: Google's
// signature, the audience, and the service account it was issued for.
type verifier struct {
	audience       string
	serviceAccount string
	client         *http.Client

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

func newVerifier(audience, serviceAccount string) *verifier {
	return &verifier{audience: audience, serviceAccount: strings.ToLower(serviceAccount), client: &http.Client{Timeout: certsTimeout}}
}

type tokenHeader struct {
	Algorithm string `json:"alg"`
	KeyID     string `json:"kid"`
}

type tokenClaims struct {
	Issuer        string `json:"iss"`
	Audience      string `json:"aud"`
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"`
	Expires       int64  `json:"exp"`
}

// verify checks an Authorization header value ("Bearer <jwt>").
func (v *verifier) verify(ctx context.Context, authorization string, now time.Time) error {
	scheme, token, ok := strings.Cut(strings.TrimSpace(authorization), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ErrUnauthorized
	}
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return ErrUnauthorized
	}
	var header tokenHeader
	if err := decodePart(parts[0], &header); err != nil || header.Algorithm != rs256 || header.KeyID == "" {
		return ErrUnauthorized
	}
	var claims tokenClaims
	if err := decodePart(parts[1], &claims); err != nil {
		return ErrUnauthorized
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return ErrUnauthorized
	}
	key, err := v.key(ctx, header.KeyID, now)
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature) != nil {
		return ErrUnauthorized
	}
	switch {
	case !googleIssuers[claims.Issuer],
		claims.Audience != v.audience,
		!now.Before(time.Unix(claims.Expires, 0).Add(tokenLeeway)),
		!strings.EqualFold(claims.Email, v.serviceAccount),
		!emailVerified(claims.EmailVerified):
		return ErrUnauthorized
	}
	return nil
}

// emailVerified reads the claim, which Google sends as a boolean and some issuers as a string.
func emailVerified(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true"
	}
	return false
}

func decodePart(part string, into any) error {
	raw, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, into)
}

// key is Google's public key with this id, read again when it is not among the ones held.
func (v *verifier) key(ctx context.Context, id string, now time.Time) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if key, ok := v.keys[id]; ok && now.Sub(v.fetched) < certsTTL {
		return key, nil
	}
	if v.keys != nil && now.Sub(v.fetched) < certsRefetchGap {
		return nil, ErrUnauthorized
	}
	keys, err := v.fetch(ctx)
	if err != nil {
		return nil, err
	}
	v.keys, v.fetched = keys, now
	if key, ok := keys[id]; ok {
		return key, nil
	}
	return nil, ErrUnauthorized
}

func (v *verifier) fetch(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, config.GoogleOIDCCertsURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := v.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read google signing keys: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("read google signing keys: status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxCertsBody))
	if err != nil {
		return nil, fmt.Errorf("read google signing keys: %w", err)
	}
	var set struct {
		Keys []struct {
			KeyID string `json:"kid"`
			Type  string `json:"kty"`
			N     string `json:"n"`
			E     string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, fmt.Errorf("decode google signing keys: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, entry := range set.Keys {
		if entry.Type != "RSA" {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(entry.N)
		e, errE := base64.RawURLEncoding.DecodeString(entry.E)
		if errN != nil || errE != nil {
			continue
		}
		keys[entry.KeyID] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	return keys, nil
}
