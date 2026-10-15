// Command agent serves the application agent to the Acorn extension. It has no database:
// the applicant is a profile.json and a folder of résumés on this machine.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/sid0709/OpenSeat/acorn-agent/agent"
	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
	"github.com/sid0709/OpenSeat/acorn-agent/httpapi"
	"github.com/sid0709/OpenSeat/acorn-agent/llm"
	"github.com/sid0709/OpenSeat/backend-core/config"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

const (
	// defaultAddr listens on this machine only: the profile and résumés never leave it.
	defaultAddr = "127.0.0.1:8090"
	// defaultDataDir is the folder holding profile.json and resumes/.
	defaultDataDir = "data"
	// defaultTraceDir is where each run's screenshots and answers are recorded. The folder
	// holds the applicant's pages and stays on this machine; ACORN_AGENT_TRACE=false turns it off.
	defaultTraceDir = "traces"
	// defaultReasoning is the reasoning effort sent with each step. "none" keeps the JSON
	// answer in the message content, as the rest of Acorn calls Luna.
	defaultReasoning = "none"
	// defaultMaxModelCalls bounds the steps in flight across every run.
	defaultMaxModelCalls = 256
	shutdownTimeout      = 10 * time.Second
)

// Environment variable names this service reads.
const (
	envOpenRouterKey = "OPENROUTER_API_KEY"
	envBaseURL       = "OPENROUTER_BASE_URL"
	envModel         = "ACORN_AGENT_MODEL"
	envReasoning     = "ACORN_AGENT_REASONING"
	envDataDir       = "ACORN_AGENT_DATA_DIR"
	envHideFields    = "ACORN_AGENT_PROFILE_HIDE"
	envTrace         = "ACORN_AGENT_TRACE"
	envTraceDir      = "ACORN_AGENT_TRACE_DIR"
	envMaxSteps      = "ACORN_AGENT_MAX_STEPS"
	envMaxActions    = "ACORN_AGENT_MAX_ACTIONS"
	envKeepTurns     = "ACORN_AGENT_KEEP_TURNS"
	envKeepImages    = "ACORN_AGENT_KEEP_IMAGES"
	envMaxStale      = "ACORN_AGENT_MAX_STALE"
	envMaxModelCalls = "ACORN_AGENT_MAX_MODEL_CALLS"
)

// defaultOrigins are the web origins allowed besides the extension, which is always allowed.
var defaultOrigins = []string{"http://localhost:3000"}

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))
	if err := run(); err != nil {
		slog.Error("agent stopped", "error", err)
		os.Exit(1)
	}
}

// isOff reports whether a switch's value turns it off.
func isOff(value string) bool {
	switch strings.ToLower(value) {
	case "false", "0", "off", "no":
		return true
	}
	return false
}

func run() error {
	config.LoadEnvFile()
	httpConfig, err := config.LoadHTTP(defaultAddr, defaultOrigins)
	if err != nil {
		return err
	}

	cfg := agent.DefaultConfig()
	cfg.MaxSteps = config.EnvInt(envMaxSteps, cfg.MaxSteps)
	cfg.MaxActions = config.EnvInt(envMaxActions, cfg.MaxActions)
	cfg.KeepTurns = config.EnvInt(envKeepTurns, cfg.KeepTurns)
	cfg.KeepImages = config.EnvInt(envKeepImages, cfg.KeepImages)
	cfg.MaxStale = config.EnvInt(envMaxStale, cfg.MaxStale)
	if !isOff(config.Env(envTrace, "")) {
		cfg.TraceDir = config.Env(envTraceDir, defaultTraceDir)
	}

	model := config.Env(envModel, config.OpenRouterModel)
	baseURL := config.Env(envBaseURL, config.OpenRouterBaseURL)
	reasoning := config.Env(envReasoning, defaultReasoning)
	// Extra profile fields the model must never see, beside applicant.DefaultHiddenFields.
	hidden := strings.Split(config.Env(envHideFields, ""), ",")
	store := applicant.NewStore(config.Env(envDataDir, defaultDataDir), hidden...)

	a := agent.New(cfg, store,
		func(key string) llm.Model { return llm.NewOpenRouter(key, model, baseURL, reasoning) },
		func(key string) agent.Decider { return jev.New(key) },
	)
	defaultKey := config.Env(envOpenRouterKey, "")
	server := &http.Server{
		Addr: httpConfig.Addr,
		Handler: httpapi.New(a, httpapi.Options{
			DefaultKey:    defaultKey,
			Origins:       httpConfig.Origins,
			ModelName:     model,
			MaxModelCalls: config.EnvInt(envMaxModelCalls, defaultMaxModelCalls),
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go jev.Warm(ctx)
	failed := make(chan error, 1)
	go func() {
		slog.Info("agent listening", "addr", httpConfig.Addr, "model", model,
			"data", store.Dir(), "key", defaultKey != "", "trace", cfg.TraceDir != "")
		failed <- server.ListenAndServe()
	}()
	select {
	case err := <-failed:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}
