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
	"github.com/sid0709/OpenSeat/acorn-agent/decide"
	"github.com/sid0709/OpenSeat/acorn-agent/httpapi"
	"github.com/sid0709/OpenSeat/acorn-agent/llm"
	"github.com/sid0709/OpenSeat/backend-core/config"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

const (
	// defaultAgentPort is the host port when HTTP_ADDR and ACORN_AGENT_PORT are unset.
	// 8090 on the VPS is JoinedHQ; do not reuse it.
	defaultAgentPort = "8093"
	// defaultAddr listens on this machine only: the profile and résumés never leave it.
	defaultAddr = "127.0.0.1:" + defaultAgentPort
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
	envStopPasses    = "ACORN_AGENT_STOP_PASSES"
	envMaxActions    = "ACORN_AGENT_MAX_ACTIONS"
	envChecks        = "ACORN_AGENT_CHECKS"
	envScreenModel   = "ACORN_AGENT_SCREEN_MODEL"
	envDecisionsURL  = "ACORN_AGENT_DECISIONS_URL"
	// envFallbackResume names the résumé folder offered to the person when a résumé is wanted and no
	// job description was found, when the applicant is a local folder.
	envFallbackResume = "DEFAULT_FALLBACK_RESUME"
	envChunkActions   = "ACORN_AGENT_CHUNK_ACTIONS"
	envVetBlock       = "ACORN_AGENT_VET_BLOCK_PERCENT"
	// envBackendURL is where acorn-backend is. When set, the applicant is the signed-in person's
	// own profile and Library there (the person's session comes with each run); otherwise it is the
	// profile.json and résumé folder on this computer.
	envBackendURL    = "ACORN_AGENT_BACKEND_URL"
	envCheckMatch    = "ACORN_AGENT_CHECK_MATCH_PERCENT"
	envCheckBlocked  = "ACORN_AGENT_CHECK_BLOCKED_PERCENT"
	envCheckLoading  = "ACORN_AGENT_CHECK_LOADING_PERCENT"
	envOptionMatch   = "ACORN_AGENT_OPTION_MATCH_PERCENT"
	envKeepTurns     = "ACORN_AGENT_KEEP_TURNS"
	envKeepImages    = "ACORN_AGENT_KEEP_IMAGES"
	envMaxStale      = "ACORN_AGENT_MAX_STALE"
	envMaxModelCalls = "ACORN_AGENT_MAX_MODEL_CALLS"
	envAgentPort     = "ACORN_AGENT_PORT"
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

// percent reads a probability given as a whole percent (90 is 0.9).
func percent(name string, fallback float64) float64 {
	return float64(config.EnvInt(name, int(fallback*100))) / 100
}

func run() error {
	config.LoadEnvFile()
	port := config.Env(envAgentPort, defaultAgentPort)
	listenAddr := defaultAddr
	if port != defaultAgentPort {
		listenAddr = "127.0.0.1:" + port
	}
	httpConfig, err := config.LoadHTTP(listenAddr, defaultOrigins)
	if err != nil {
		return err
	}

	cfg := agent.DefaultConfig()
	cfg.MaxSteps = config.EnvInt(envMaxSteps, cfg.MaxSteps)
	cfg.StopPasses = config.EnvInt(envStopPasses, cfg.StopPasses)
	cfg.MaxActions = config.EnvInt(envMaxActions, cfg.MaxActions)
	cfg.ChunkActions = config.EnvInt(envChunkActions, cfg.ChunkActions)
	cfg.CheckMatch = percent(envCheckMatch, cfg.CheckMatch)
	cfg.CheckBlocked = percent(envCheckBlocked, cfg.CheckBlocked)
	cfg.CheckLoading = percent(envCheckLoading, cfg.CheckLoading)
	cfg.OptionMatch = percent(envOptionMatch, cfg.OptionMatch)
	cfg.VetBlock = percent(envVetBlock, 0.3)
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
	var source applicant.Source
	location := ""
	if backendURL := strings.TrimSpace(config.Env(envBackendURL, "")); backendURL != "" {
		source = applicant.NewBackend(backendURL, hidden...)
		location = backendURL
	} else {
		store := applicant.NewStore(config.Env(envDataDir, defaultDataDir), hidden...)
		source = store
		location = store.Dir()
		// One person's own folder: its default résumé is named here, and a name that is not in it
		// is a mistake to report. With the backend the default is the one each person marked in
		// their Library, so there is no setting.
		cfg.FallbackStrict = true
		cfg.FallbackResume = config.Env(envFallbackResume, "")
	}

	// The checks between a plan's runs of actions need a decision model that reads a screenshot.
	decisionsURL := config.Env(envDecisionsURL, config.OpenRouterDecisionsURL)
	var newScreen func(key string) agent.Screen
	screenModel := config.Env(envScreenModel, config.ScreenDecisionModel)
	if !isOff(config.Env(envChecks, "")) {
		newScreen = func(key string) agent.Screen { return decide.New(key, screenModel, decisionsURL) }
	}
	a := agent.New(cfg, source,
		func(key string) llm.Model { return llm.NewOpenRouter(key, model, baseURL, reasoning) },
		func(key string) agent.Decider { return jev.NewWithURL(key, decisionsURL) },
		newScreen,
	)
	defaultKey := config.Env(envOpenRouterKey, "")
	server := &http.Server{
		Addr: httpConfig.Addr,
		Handler: httpapi.New(a, httpapi.Options{
			DefaultKey:    defaultKey,
			Origins:       httpConfig.Origins,
			ModelName:     model,
			Source:        source.Kind(),
			MaxModelCalls: config.EnvInt(envMaxModelCalls, defaultMaxModelCalls),
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go jev.Warm(ctx)
	if newScreen != nil {
		go decide.Warm(ctx, decisionsURL)
	}
	failed := make(chan error, 1)
	go func() {
		slog.Info("agent listening", "addr", httpConfig.Addr, "model", model,
			"checks", newScreen != nil, "screenModel", screenModel,
			"applicant", source.Kind(), "from", location, "key", defaultKey != "", "trace", cfg.TraceDir != "")
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
