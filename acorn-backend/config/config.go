// Package config reads the settings every backend service shares. Each service
// composes the parts it needs and reads its own settings with Env.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultDestDB              = "AcornDB"
	defaultJobsCollection      = "jobs"
	defaultCompaniesCollection = "companies"

	// RunScreenshotsCollection holds the full-page image of each Run that sent an application.
	RunScreenshotsCollection = "acorn_run_screenshots"
	// RunScreenshotRetention is how long a Run's image is kept; the Run row itself stays.
	RunScreenshotRetention = 90 * 24 * time.Hour
	// MaxRunScreenshotBytes bounds one uploaded image (JPEG).
	MaxRunScreenshotBytes = 6 << 20

	// OpenRouter is the only model Acorn calls. The key lives on the account profile,
	// not in the environment.
	OpenRouterProvider = "openrouter"
	OpenRouterModel    = "openai/gpt-6-luna"
	OpenRouterBaseURL  = "https://openrouter.ai/api/v1"
	// JevModel is TypeSafe's decision model. Acorn's SelectorGateway sends it every
	// pick-one decision (dropdown option, Library résumé) on the same OpenRouter key.
	JevModel = "typesafe/jev-1.13"
	// ScreenDecisionModel is the decision model that reads a screenshot and says whether it
	// shows what was expected (the acorn-agent's checks between steps). It is billed on input
	// tokens only, at the same rate as GPT-6 Luna's input.
	ScreenDecisionModel    = "openai/gpt-6-luna-decisions"
	OpenRouterDecisionsURL = "https://openrouter.ai/api/alpha/decisions"
	// OpenAIDecisionsURL is OpenAI's own Decisions API, and OpenAIDecisionModel the model it serves: the
	// acorn-agent asks its decisions about screenshots there, on the profile's OpenAI key.
	OpenAIDecisionsURL  = "https://api.openai.com/v1/decisions"
	OpenAIDecisionModel = "gpt-6-luna"
	// OpenRouterKeyURL and OpenAIModelsURL answer 200 for a working key and 401 for one that is not: the
	// cheapest way to tell the person whether each key of the profile works.
	OpenRouterKeyURL = "https://openrouter.ai/api/v1/key"
	// GoogleOIDCCertsURL publishes the keys Google signs ID tokens with, among them the token a
	// Pub/Sub push subscription sends.
	GoogleOIDCCertsURL = "https://www.googleapis.com/oauth2/v3/certs"
	OpenAIModelsURL    = "https://api.openai.com/v1/models"
	envFileName        = ".env"

	// GmailWatchCollection holds one row per watched mailbox: its history cursor and watch expiry.
	GmailWatchCollection = "acorn_gmail_watch"
	// GmailProcessedCollection holds the ids of messages already looked at, never their content.
	GmailProcessedCollection = "acorn_gmail_processed"
	// GmailProcessedRetention is how long a message id is remembered. Pub/Sub delivers at least once,
	// so a repeat inside this span is skipped without a second model call.
	GmailProcessedRetention = 7 * 24 * time.Hour
	// VerifyMailLabel is the one Gmail label put on mail that delivers a verification code or link.
	VerifyMailLabel = "oak-verify-email"
	// VerifyMailFeature is the usage feature of the model call that classifies an arriving email.
	VerifyMailFeature = "mail_verify_label"
	// VerifyMailClient is the usage client of that call: the server itself, not a browser.
	VerifyMailClient = "acorn-backend"

	defaultMailVerifyMinConfidence = 0.8
	// DefaultMailVerifyPollInterval is how often polling mode reads each mailbox's history, and
	// MinMailVerifyPollInterval the shortest it may be set to: each read costs Gmail quota.
	DefaultMailVerifyPollInterval = 30 * time.Second
	MinMailVerifyPollInterval     = 10 * time.Second
)

// Database is the MongoDB Acorn's server uses: its own collections and the shared job catalog.
type Database struct {
	MongoURI            string
	DestDB              string
	JobsCollection      string
	CompaniesCollection string
}

// Google is the OAuth client from Google Cloud and where Sign in with Google
// returns to: the app's frontend callback page, registered on that client.
type Google struct {
	ClientID          string
	ClientSecret      string
	SignInRedirectURL string
	GmailRedirectURL  string
}

// HTTP is where a service listens and which browser origins may call it.
type HTTP struct {
	Addr    string
	Origins []string
}

// MailWatch is how arriving Gmail is noticed. With a Topic, Gmail publishes a mailbox's changes
// to a Pub/Sub topic and a push subscription calls POST /acorn/gmail/push on this server (real
// time, and Google Cloud must have billing on for Pub/Sub). Without one, the server polls each
// mailbox's history every PollInterval instead: a light history.list call, 2 Gmail quota units.
type MailWatch struct {
	// Topic is the full Pub/Sub topic name, "projects/<project>/topics/<topic>". Empty means poll.
	Topic string
	// Audience and ServiceAccount are what the push subscription's OIDC token must carry: the
	// "aud" claim, and the "email" of the service account the subscription signs with.
	Audience       string
	ServiceAccount string
	// MinConfidence is the least probability, 0 to 1, that an email delivers a verification code or
	// link before it is labelled.
	MinConfidence float64
	// PollInterval is how often polling mode reads each mailbox; unused with a Topic.
	PollInterval time.Duration
}

// Push reports whether Gmail push is configured; otherwise mail is polled.
func (m MailWatch) Push() bool { return m.Topic != "" }

// ErrorReporting is optional monitoring. Empty fields mean no outbound calls.
type ErrorReporting struct {
	SentryDSN string
}

// LoadEnvFile reads .env from the working directory. Variables already set in
// the environment win.
func LoadEnvFile() {
	loadEnvFile(envFileName)
}

// LoadEnvFileAt reads one env file. Variables already set in the environment win.
func LoadEnvFileAt(path string) {
	loadEnvFile(path)
}

func LoadDatabase() (Database, error) {
	db := Database{
		MongoURI:            strings.TrimSpace(os.Getenv("MONGO_URI")),
		DestDB:              Env("DEST_DB", defaultDestDB),
		JobsCollection:      Env("JOBS_COLLECTION", defaultJobsCollection),
		CompaniesCollection: Env("COMPANIES_COLLECTION", defaultCompaniesCollection),
	}
	if db.MongoURI == "" {
		return Database{}, fmt.Errorf("MONGO_URI is required")
	}
	return db, nil
}

func LoadGoogle() Google {
	signIn := Env("GOOGLE_SIGNIN_REDIRECT_URL", "")
	gmail := Env("GOOGLE_GMAIL_REDIRECT_URL", "")
	if gmail == "" {
		gmail = GmailRedirectFromSignIn(signIn)
	}
	return Google{
		ClientID:          Env("GOOGLE_CLIENT_ID", ""),
		ClientSecret:      Env("GOOGLE_CLIENT_SECRET", ""),
		SignInRedirectURL: signIn,
		GmailRedirectURL:  gmail,
	}
}

// GmailRedirectFromSignIn is the Gmail OAuth callback on the same host as sign-in.
func GmailRedirectFromSignIn(signInRedirectURL string) string {
	const signInSuffix = "/auth/google/callback"
	const gmailSuffix = "/auth/gmail/callback"
	if !strings.HasSuffix(signInRedirectURL, signInSuffix) {
		return ""
	}
	return strings.TrimSuffix(signInRedirectURL, signInSuffix) + gmailSuffix
}

// LoadMailWatch reads the Gmail watch settings. Push needs all three of GMAIL_PUSH_TOPIC,
// GMAIL_PUSH_AUDIENCE and GMAIL_PUSH_SERVICE_ACCOUNT: with a topic but not the other two, the push
// endpoint could not tell Pub/Sub's calls from anyone else's, so the error says which is missing.
// Without a topic the settings are the polling ones (MAIL_VERIFY_POLL_INTERVAL).
func LoadMailWatch() (MailWatch, error) {
	watch := MailWatch{
		Topic:          Env("GMAIL_PUSH_TOPIC", ""),
		Audience:       Env("GMAIL_PUSH_AUDIENCE", ""),
		ServiceAccount: Env("GMAIL_PUSH_SERVICE_ACCOUNT", ""),
		MinConfidence:  defaultMailVerifyMinConfidence,
		PollInterval:   DefaultMailVerifyPollInterval,
	}
	if raw := Env("MAIL_VERIFY_MIN_CONFIDENCE", ""); raw != "" {
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || value <= 0 || value > 1 {
			return MailWatch{}, fmt.Errorf("MAIL_VERIFY_MIN_CONFIDENCE must be a number above 0 and at most 1")
		}
		watch.MinConfidence = value
	}
	if raw := Env("MAIL_VERIFY_POLL_INTERVAL", ""); raw != "" {
		value, err := time.ParseDuration(raw)
		if err != nil || value < MinMailVerifyPollInterval {
			return MailWatch{}, fmt.Errorf("MAIL_VERIFY_POLL_INTERVAL must be a duration of at least %s, like 30s", MinMailVerifyPollInterval)
		}
		watch.PollInterval = value
	}
	if watch.Topic != "" && (watch.Audience == "" || watch.ServiceAccount == "") {
		return MailWatch{}, fmt.Errorf("GMAIL_PUSH_TOPIC needs GMAIL_PUSH_AUDIENCE and GMAIL_PUSH_SERVICE_ACCOUNT too")
	}
	return watch, nil
}

// LoadHTTP reads HTTP_ADDR and CORS_ORIGINS, falling back to the service's defaults.
func LoadHTTP(defaultAddr string, defaultOrigins []string) (HTTP, error) {
	cfg := HTTP{
		Addr:    Env("HTTP_ADDR", defaultAddr),
		Origins: splitList(Env("CORS_ORIGINS", strings.Join(defaultOrigins, ","))),
	}
	if len(cfg.Origins) == 0 {
		return HTTP{}, fmt.Errorf("CORS_ORIGINS is required")
	}
	return cfg, nil
}

// LoadErrorReporting reads SENTRY_DSN from the environment.
// It is optional. An empty value does not crash and does not dial out.
func LoadErrorReporting() ErrorReporting {
	return ErrorReporting{
		SentryDSN: strings.TrimSpace(os.Getenv("SENTRY_DSN")),
	}
}

// Env returns the trimmed value of key, or fallback when it is unset or blank.
func Env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

// EnvInt returns key as a positive whole number, or fallback when it is unset or not one.
func EnvInt(key string, fallback int) int {
	value, err := strconv.Atoi(Env(key, ""))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

func Redact(err error, uri string) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if uri != "" {
		msg = strings.ReplaceAll(msg, uri, "mongodb://[redacted]")
	}
	parsed, parseErr := url.Parse(uri)
	if parseErr == nil && parsed.User != nil {
		if password, ok := parsed.User.Password(); ok && password != "" {
			msg = strings.ReplaceAll(msg, password, "[redacted]")
		}
		if username := parsed.User.Username(); username != "" {
			msg = strings.ReplaceAll(msg, username, "[redacted]")
		}
	}
	return msg
}

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			items = append(items, part)
		}
	}
	return items
}

func loadEnvFile(path string) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(contents), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, value)
	}
}
