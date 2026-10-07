// Command server runs Acorn's API. The extension calls /acorn and the Socket.IO
// gateway on this process. Accounts, sessions, and the rest of Acorn's data live
// in AcornDB.
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/acornapi"
	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
	"github.com/sid0709/OpenSeat/acorn-backend/debugtrace"
	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/profile"
	"github.com/sid0709/OpenSeat/acorn-backend/resume"
	"github.com/sid0709/OpenSeat/backend-core/config"
	"github.com/sid0709/OpenSeat/backend-core/google"
	"github.com/sid0709/OpenSeat/backend-core/httpkit"
	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/platform"
)

const (
	defaultHTTPAddr   = "127.0.0.1:8083"
	defaultRuntimeKey = "runtime_file"
	// defaultDatabase is Acorn's own database.
	defaultDatabase = "AcornDB"
)

// acorn-frontend, plus the older UI board. The extension is not a browser origin.
var defaultOrigins = []string{
	"http://127.0.0.1:6005",
	"http://localhost:6005",
	"http://127.0.0.1:5173",
	"http://localhost:5173",
}

func main() {
	if _, exists := os.LookupEnv("MONGO_URI"); exists {
		slog.Warn("MONGO_URI is already set in the process environment, so acorn-backend/.env will not replace it")
	}
	envFile, err := loadAcornEnv()
	if err != nil {
		slog.Error("config", "error", err)
		os.Exit(1)
	}
	if envFile == "" {
		slog.Info("acorn-backend/.env not present; using the process environment")
	}
	db, err := config.LoadDatabase()
	if err != nil {
		slog.Error("config", "error", err)
		os.Exit(1)
	}
	// Acorn reads ACORN_DB so a shared environment cannot point this process at another database.
	db.DestDB = config.Env("ACORN_DB", defaultDatabase)
	slog.Info("mongo", "envFile", envFile, "host", mongoHost(db.MongoURI), "database", db.DestDB)
	server, err := config.LoadHTTP(defaultHTTPAddr, defaultOrigins)
	if err != nil {
		slog.Error("config", "error", err)
		os.Exit(1)
	}
	googleConfig := config.LoadGoogle()
	oauth := &google.Client{ClientID: googleConfig.ClientID, ClientSecret: googleConfig.ClientSecret}
	if !oauth.Configured() || googleConfig.SignInRedirectURL == "" {
		slog.Warn("Google sign-in is off until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_SIGNIN_REDIRECT_URL are set")
	}
	if !oauth.Configured() || googleConfig.GmailRedirectURL == "" {
		slog.Warn("Gmail is off until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_GMAIL_REDIRECT_URL are set")
	}

	p, err := platform.Open(context.Background(), db, platform.Options{})
	if err != nil {
		slog.Error("platform", "error", config.Redact(err, db.MongoURI))
		os.Exit(1)
	}
	defer p.Close()

	reporter := httpkit.NewReporter(config.LoadErrorReporting().SentryDSN)
	accounts := account.NewStore(p.Mongo(), db.DestDB)
	if err := accounts.EnsureIndexes(context.Background()); err != nil {
		slog.Error("acorn accounts", "error", err)
		os.Exit(1)
	}
	resumes := resume.New(resume.NewStore(p.Mongo(), db.DestDB), nil)
	if err := resumes.EnsureIndexes(context.Background()); err != nil {
		slog.Error("acorn resumes", "error", err)
		os.Exit(1)
	}
	profiles := profile.NewStore(p.Mongo(), db.DestDB, nil)
	if err := profiles.EnsureIndexes(context.Background()); err != nil {
		slog.Error("acorn profiles", "error", err)
		os.Exit(1)
	}
	usage := aiusage.NewStore(p.Mongo(), db.DestDB)
	if err := usage.EnsureIndexes(context.Background()); err != nil {
		slog.Error("acorn ai usage", "error", err)
		os.Exit(1)
	}
	gmailGoogle := &mailbox.Google{OAuth: oauth, RedirectURL: googleConfig.GmailRedirectURL}
	gmailStore := mailbox.NewStore(p.Mongo(), db.DestDB, gmailGoogle)
	if err := gmailStore.EnsureIndexes(context.Background()); err != nil {
		slog.Error("acorn gmail", "error", err)
		os.Exit(1)
	}
	// Local debug capture: pages, profiles, prompts, and plans land on disk. Never set in production.
	debug := debugtrace.New(config.Env("ACORN_DEBUG_DIR", ""))
	if debug != nil {
		slog.Warn("Acorn debug capture is on: page HTML, applicant profiles, and AI prompts are written to disk", "dir", debug.Dir())
	}
	acornHandler, gateway := acornapi.New(accounts, p.Jobs, acorn.New(nil), acornapi.Options{
		Resumes:       resumes,
		Profiles:      profiles,
		SessionCookie: config.Env("ACORN_SESSION_COOKIE", acornapi.DefaultSessionCookie),
		Runtime: acornapi.RuntimeFile{
			Path: config.Env("ACORN_RUNTIME_FILE_PATH", ""),
			Key:  config.Env("ACORN_RUNTIME_FILE_KEY", defaultRuntimeKey),
		},
		KillSwitches:      p.KillSwitches,
		Google:            oauth,
		GoogleRedirectURL: googleConfig.SignInRedirectURL,
		Gmail:             gmailStore,
		GmailRedirectURL:  googleConfig.GmailRedirectURL,
		Debug:             debug,
		Usage:             usage,
	})
	defer gateway.Close()

	// The SelectorGateway's first Jev decision would otherwise open the TLS connection.
	go jev.Warm(context.Background())

	handler := routes(server.Origins, httpkit.Health(p.Jobs), acornHandler, slog.Default(), reporter)
	if err := httpkit.Serve("acorn api", server.Addr, handler); err != nil {
		slog.Error("server", "error", err)
		os.Exit(1)
	}
}
