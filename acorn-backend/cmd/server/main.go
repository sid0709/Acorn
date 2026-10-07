// Command server runs Acorn's API. The extension calls /acorn and the Socket.IO
// gateway on this process. Accounts, sessions, and the rest of Acorn's data live
// in AcornDB.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/acornapi"
	"github.com/sid0709/OpenSeat/acorn-backend/admin"
	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
	"github.com/sid0709/OpenSeat/acorn-backend/debugtrace"
	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/profile"
	"github.com/sid0709/OpenSeat/acorn-backend/resume"
	"github.com/sid0709/OpenSeat/acorn-backend/support"
	"github.com/sid0709/OpenSeat/acorn-backend/supportaccess"
	"github.com/sid0709/OpenSeat/backend-core/config"
	"github.com/sid0709/OpenSeat/backend-core/google"
	"github.com/sid0709/OpenSeat/backend-core/httpkit"
	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/platform"
	"golang.org/x/sync/errgroup"
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
	"http://127.0.0.1:6010",
	"http://localhost:6010",
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
		slog.Warn("Gmail is off until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and a Gmail redirect are set (GOOGLE_GMAIL_REDIRECT_URL, or GOOGLE_SIGNIN_REDIRECT_URL ending in /auth/google/callback)")
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
	profiles := profile.NewStore(p.Mongo(), db.DestDB, nil)
	usage := aiusage.NewStore(p.Mongo(), db.DestDB)
	claims := support.NewStore(p.Mongo(), db.DestDB)
	supportAccess := supportaccess.NewStore(p.Mongo(), db.DestDB)
	webURL := config.Env("ACORN_WEB_URL", "")
	if webURL == "" {
		slog.Warn("Support sign-in (admin \"Sign in as user\") is off until ACORN_WEB_URL is set")
	}
	adminDemo := admin.DemoMode()
	if adminDemo {
		slog.Warn("Acorn admin demo mode is on: any password works for admin sign-in; set ACORN_ADMIN_DEMO=off in production")
	}
	adminStore := admin.NewStore(p.Mongo(), db.DestDB, admin.Config{
		SessionSecret:     config.Env("ACORN_ADMIN_SESSION_SECRET", ""),
		BootstrapEmail:    config.Env("ACORN_ADMIN_EMAIL", ""),
		BootstrapPassword: config.Env("ACORN_ADMIN_PASSWORD", ""),
		DemoMode:          adminDemo,
	})
	gmailGoogle := &mailbox.Google{OAuth: oauth, RedirectURL: googleConfig.GmailRedirectURL}
	gmailStore := mailbox.NewStore(p.Mongo(), db.DestDB, gmailGoogle)

	// Each store owns its own collections, so the index builds run side by side.
	indexed := []struct {
		name  string
		store interface{ EnsureIndexes(context.Context) error }
	}{
		{"acorn accounts", accounts},
		{"acorn resumes", resumes},
		{"acorn profiles", profiles},
		{"acorn ai usage", usage},
		{"acorn support claims", claims},
		{"acorn admin", adminStore},
		{"acorn support access", supportAccess},
		{"acorn gmail", gmailStore},
	}
	indexGroup, indexCtx := errgroup.WithContext(context.Background())
	for _, item := range indexed {
		indexGroup.Go(func() error {
			if err := item.store.EnsureIndexes(indexCtx); err != nil {
				return fmt.Errorf("%s: %w", item.name, err)
			}
			return nil
		})
	}
	if err := indexGroup.Wait(); err != nil {
		slog.Error("acorn indexes", "error", err)
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
		KillSwitches:       p.KillSwitches,
		Google:             oauth,
		GoogleRedirectURL:  googleConfig.SignInRedirectURL,
		Gmail:              gmailStore,
		GmailRedirectURL:   googleConfig.GmailRedirectURL,
		Debug:              debug,
		Usage:              usage,
		Claims:             claims,
		Admins:             adminStore,
		AdminSessionCookie: acornapi.DefaultAdminSessionCookie,
		SupportAccess:      supportAccess,
		WebURL:             webURL,
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
