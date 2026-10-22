// Command server runs Acorn's API. The extension calls /acorn and the Socket.IO
// gateway on this process. Accounts, sessions, and the rest of Acorn's data live
// in AcornDB.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/sid0709/acorn/acorn-backend/account"
	"github.com/sid0709/acorn/acorn-backend/acorn"
	"github.com/sid0709/acorn/acorn-backend/acornapi"
	"github.com/sid0709/acorn/acorn-backend/admin"
	"github.com/sid0709/acorn/acorn-backend/aiusage"
	"github.com/sid0709/acorn/acorn-backend/config"
	"github.com/sid0709/acorn/acorn-backend/debugtrace"
	"github.com/sid0709/acorn/acorn-backend/internal/google"
	"github.com/sid0709/acorn/acorn-backend/internal/httpkit"
	"github.com/sid0709/acorn/acorn-backend/internal/platform"
	"github.com/sid0709/acorn/acorn-backend/jev"
	"github.com/sid0709/acorn/acorn-backend/mailbox"
	"github.com/sid0709/acorn/acorn-backend/mailwatch"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
	"github.com/sid0709/acorn/acorn-backend/profile"
	"github.com/sid0709/acorn/acorn-backend/resume"
	"github.com/sid0709/acorn/acorn-backend/runs"
	"github.com/sid0709/acorn/acorn-backend/support"
	"github.com/sid0709/acorn/acorn-backend/supportaccess"
	"golang.org/x/sync/errgroup"
)

const (
	defaultHTTPAddr = "127.0.0.1:8083"
	// defaultDatabase is Acorn's own database.
	defaultDatabase = "AcornDB"
	// defaultWebURL is acorn-frontend in production, where support sign-in links land.
	// ACORN_WEB_URL overrides it (local development sets http://localhost:6005).
	defaultWebURL = "https://acornapply.com"
	// defaultLibraryCacheMB is the most of the Library kept in memory (résumé files, with the
	// ones used longest ago dropped past it). ACORN_LIBRARY_CACHE_MB overrides it.
	defaultLibraryCacheMB = resume.DefaultCacheMaxBytes >> 20
	// recentAccountsFirst is how many recently signed-in accounts load into memory before the rest.
	recentAccountsFirst = 500
)

// acorn-frontend, plus the older UI board. The extension is not a browser origin.
var defaultOrigins = []string{
	"http://127.0.0.1:6005",
	"http://localhost:6005",
	"http://127.0.0.1:5173",
	"http://localhost:5173",
	"http://127.0.0.1:6010",
	"http://localhost:6010",
	"https://acornapply.com",
	"https://www.acornapply.com",
	"https://admin.acornapply.com",
}

func main() {
	slog.SetDefault(slog.New(plainlog.New(os.Stderr, logLevel())))
	if _, exists := os.LookupEnv("MONGO_URI"); exists {
		slog.Warn("MONGO_URI is already set in the environment, so acorn-backend/.env will not replace it.")
	}
	envFile, err := loadAcornEnv()
	if err != nil {
		slog.Error("Could not read the server settings", plainlog.ErrorKey, err)
		os.Exit(1)
	}
	if envFile == "" {
		slog.Info("There is no acorn-backend/.env file, so the settings come from the environment.")
	}
	db, err := config.LoadDatabase()
	if err != nil {
		slog.Error("Could not read the server settings", plainlog.ErrorKey, err)
		os.Exit(1)
	}
	// Acorn reads ACORN_DB so a shared environment cannot point this process at another database.
	db.DestDB = config.Env("ACORN_DB", defaultDatabase)
	slog.Info(fmt.Sprintf("Using the database %s on %s%s.", db.DestDB, mongoHost(db.MongoURI), settingsFrom(envFile)))
	server, err := config.LoadHTTP(defaultHTTPAddr, defaultOrigins)
	if err != nil {
		slog.Error("Could not read the server settings", plainlog.ErrorKey, err)
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

	p, err := platform.Open(context.Background(), db)
	if err != nil {
		slog.Error("Could not open the database", plainlog.ErrorKey, config.Redact(err, db.MongoURI))
		os.Exit(1)
	}
	defer p.Close()

	reporter := httpkit.NewReporter(config.LoadErrorReporting().SentryDSN)
	accounts := account.NewStore(p.Mongo(), db.DestDB)
	if err := accounts.EnsureIndexes(context.Background()); err != nil {
		slog.Error("Could not prepare the account indexes", plainlog.ErrorKey, err)
		os.Exit(1)
	}
	// This server is the only process that writes the Library and profiles, so what it holds in
	// memory is kept until a write through it changes it. ACORN_CACHE_TRUST_SECONDS sets a window
	// after which a copy is read again, for a deployment where another process can write them.
	cacheTrust := time.Duration(config.EnvInt("ACORN_CACHE_TRUST_SECONDS", 0)) * time.Second
	resumeStore := resume.NewStore(p.Mongo(), db.DestDB)
	resumeStore.SetCache(config.EnvInt("ACORN_LIBRARY_CACHE_MB", defaultLibraryCacheMB)<<20, cacheTrust)
	resumes := resume.New(resumeStore, nil)
	profiles := profile.NewStore(p.Mongo(), db.DestDB, nil)
	profiles.SetTrust(cacheTrust)
	usage := aiusage.NewStore(p.Mongo(), db.DestDB)
	completedRuns := runs.NewStore(p.Mongo(), db.DestDB)
	claims := support.NewStore(p.Mongo(), db.DestDB)
	supportAccess := supportaccess.NewStore(p.Mongo(), db.DestDB)
	webURL := config.Env("ACORN_WEB_URL", defaultWebURL)
	if webURL == "" {
		slog.Warn("Support sign-in (admin \"Sign in as user\") is off until ACORN_WEB_URL is set")
	}
	adminDemo := admin.DemoMode()
	if adminDemo {
		slog.Warn("Admin demo mode is on, so the admin session uses a default secret. In production, set ACORN_ADMIN_DEMO=off and ACORN_ADMIN_SESSION_SECRET.")
	}
	adminStore := admin.NewStore(p.Mongo(), db.DestDB, admin.Config{
		SessionSecret:     config.Env("ACORN_ADMIN_SESSION_SECRET", ""),
		BootstrapEmail:    config.Env("ACORN_ADMIN_EMAIL", ""),
		BootstrapPassword: config.Env("ACORN_ADMIN_PASSWORD", ""),
		DemoMode:          adminDemo,
	})
	gmailGoogle := &mailbox.Google{OAuth: oauth, RedirectURL: googleConfig.GmailRedirectURL}
	gmailStore := mailbox.NewStore(p.Mongo(), db.DestDB, gmailGoogle)
	mailWatchConfig, err := config.LoadMailWatch()
	if err != nil {
		slog.Error("Could not read the server settings", plainlog.ErrorKey, err)
		os.Exit(1)
	}
	mailWatchStore := mailwatch.NewStore(p.Mongo(), db.DestDB)
	// Process capture of every tab session (pages, trees, decisions, prompts), kept
	// for debugtrace.SessionRetention so a support report can carry the whole session.
	traces := debugtrace.NewMongoStore(p.Mongo(), db.DestDB)

	// Each store owns its own collections, so the index builds run side by side.
	indexed := []struct {
		name  string
		store interface{ EnsureIndexes(context.Context) error }
	}{
		{"acorn accounts", accounts},
		{"acorn resumes", resumes},
		{"acorn profiles", profiles},
		{"acorn ai usage", usage},
		{"acorn runs", completedRuns},
		{"acorn support claims", claims},
		{"acorn admin", adminStore},
		{"acorn support access", supportAccess},
		{"acorn gmail", gmailStore},
		{"acorn gmail watch", mailWatchStore},
		{"acorn debug traces", traces},
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
		slog.Error("Could not prepare the database indexes", plainlog.ErrorKey, err)
		os.Exit(1)
	}
	// Capture goes to MongoDB for support reports; ACORN_DEBUG_DIR also writes it to
	// local folders (a developer's machine only).
	var traceStore debugtrace.Store
	if traces != nil {
		traceStore = traces
	}
	debug := debugtrace.New(config.Env("ACORN_DEBUG_DIR", ""), traceStore)
	if debug != nil && debug.Dir() != "" {
		slog.Warn("Debug capture also saves page HTML, applicant profiles and AI prompts to " + debug.Dir() + ". Use it on a developer machine only.")
	}
	var mailWatch *mailwatch.Service
	if gmailStore.Ready() {
		mailWatch = mailwatch.New(mailwatch.Options{
			Config: mailWatchConfig, Store: mailWatchStore, Mailboxes: gmailStore,
			Gmail: gmailGoogle, Profiles: profiles, Usage: usage,
		})
		mailWatch.Start()
		defer mailWatch.Close()
	} else {
		slog.Warn("Arriving Gmail is not watched until Gmail is set up")
	}
	acornHandler, gateway := acornapi.New(accounts, p.Jobs, acorn.New(nil), acornapi.Options{
		Resumes:            resumes,
		Profiles:           profiles,
		SessionCookie:      config.Env("ACORN_SESSION_COOKIE", acornapi.DefaultSessionCookie),
		KillSwitches:       p.KillSwitches,
		Google:             oauth,
		GoogleRedirectURL:  googleConfig.SignInRedirectURL,
		Gmail:              gmailStore,
		GmailRedirectURL:   googleConfig.GmailRedirectURL,
		GmailGoogle:        gmailGoogle,
		MailWatch:          mailWatch,
		Debug:              debug,
		Usage:              usage,
		Runs:               completedRuns,
		Claims:             claims,
		Admins:             adminStore,
		AdminSessionCookie: acornapi.DefaultAdminSessionCookie,
		SupportAccess:      supportAccess,
		WebURL:             webURL,
	})
	defer gateway.Close()

	// The SelectorGateway's first Jev decision would otherwise open the TLS connection.
	go jev.Warm(context.Background())

	// Every account's Library files load into memory in the background, the recently signed-in
	// first, so a run's file reads are served from memory. The server answers meanwhile: an
	// account not loaded yet reads its own files as before. ACORN_LIBRARY_PRELOAD=off skips it
	// (a development server on a distant database would pull every account's files at each start).
	preloadCtx, stopPreload := context.WithCancel(context.Background())
	defer stopPreload()
	if config.Env("ACORN_LIBRARY_PRELOAD", "on") != "off" {
		go func() {
			recent, err := accounts.RecentUserIDs(preloadCtx, time.Now(), recentAccountsFirst)
			if err != nil {
				slog.Warn("Could not read who signed in lately, so libraries load in upload order instead.", plainlog.ErrorKey, err)
			}
			resumes.Preload(preloadCtx, recent)
		}()
	}

	handler := routes(server.Origins, httpkit.Health(p.Jobs), acornHandler, slog.Default(), reporter)
	if err := httpkit.Serve("acorn api", server.Addr, handler); err != nil {
		slog.Error("The server stopped", plainlog.ErrorKey, err)
		os.Exit(1)
	}
}
