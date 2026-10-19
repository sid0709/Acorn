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
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/sid0709/acorn/acorn-agent/agent"
	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-agent/httpapi"
	"github.com/sid0709/acorn/acorn-agent/llm"
	"github.com/sid0709/acorn/acorn-backend/config"
	"github.com/sid0709/acorn/acorn-backend/jev"
)

const (
	// defaultAgentPort is the host port when HTTP_ADDR and ACORN_AGENT_PORT are unset.
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
	// The model that drives a run on a person's OpenAI key, and its list prices in USD per million tokens. OpenAI's own
	// API reports no cost, so each call is priced from these. They are OpenRouter's published rates for
	// openai/gpt-6-luna (prompt 0.10, completion 0.50, cache read 0.01, cache write 0.125), which OpenAI's price
	// pages repeat; check developers.openai.com/api/docs/pricing and set the ACORN_AGENT_OPENAI_PRICE_* values if they differ.
	defaultOpenAIBaseURL         = "https://api.openai.com/v1"
	defaultOpenAIModel           = "gpt-6-luna"
	defaultOpenAIPriceInput      = 0.10
	defaultOpenAIPriceCached     = 0.01
	defaultOpenAIPriceCacheWrite = 0.125
	defaultOpenAIPriceOutput     = 0.50
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
	// ACORN_AGENT_OPENAI=false drives every run on OpenRouter, whatever keys the profiles hold.
	envOpenAI                = "ACORN_AGENT_OPENAI"
	envOpenAIBaseURL         = "ACORN_AGENT_OPENAI_BASE_URL"
	envOpenAIModel           = "ACORN_AGENT_OPENAI_MODEL"
	envOpenAIPriceInput      = "ACORN_AGENT_OPENAI_PRICE_INPUT"
	envOpenAIPriceCached     = "ACORN_AGENT_OPENAI_PRICE_CACHED"
	envOpenAIPriceCacheWrite = "ACORN_AGENT_OPENAI_PRICE_CACHE_WRITE"
	envOpenAIPriceOutput     = "ACORN_AGENT_OPENAI_PRICE_OUTPUT"
	envDataDir               = "ACORN_AGENT_DATA_DIR"
	envHideFields            = "ACORN_AGENT_PROFILE_HIDE"
	envTrace                 = "ACORN_AGENT_TRACE"
	envTraceDir              = "ACORN_AGENT_TRACE_DIR"
	envMaxSteps              = "ACORN_AGENT_MAX_STEPS"
	envStopPasses            = "ACORN_AGENT_STOP_PASSES"
	envDonePasses            = "ACORN_AGENT_DONE_PASSES"
	envDoneConfirm           = "ACORN_AGENT_DONE_CONFIRM_PERCENT"
	envMaxActions            = "ACORN_AGENT_MAX_ACTIONS"
	envChecks                = "ACORN_AGENT_CHECKS"
	envScreenModel           = "ACORN_AGENT_SCREEN_MODEL"
	envDecisionsURL          = "ACORN_AGENT_DECISIONS_URL"
	// envFallbackResume names the résumé folder offered to the person when a résumé is wanted and no
	// job description was found, when the applicant is a local folder.
	envFallbackResume = "DEFAULT_FALLBACK_RESUME"
	envChunkActions   = "ACORN_AGENT_CHUNK_ACTIONS"
	envVetBlock       = "ACORN_AGENT_VET_BLOCK_PERCENT"
	envVetClickBlock  = "ACORN_AGENT_VET_CLICK_BLOCK_PERCENT"
	envSignOnBlock    = "ACORN_AGENT_SSO_BLOCK_PERCENT"
	envAccountTries   = "ACORN_AGENT_ACCOUNT_ATTEMPTS"
	envMaxPrefills    = "ACORN_AGENT_MAX_PREFILLS"
	envMaxReviews     = "ACORN_AGENT_MAX_REVIEWS"
	envMaxAdvances    = "ACORN_AGENT_MAX_ADVANCES"
	envMaxPicks       = "ACORN_AGENT_MAX_PICKS"
	envPickMatch      = "ACORN_AGENT_PICK_PERCENT"
	envPickMargin     = "ACORN_AGENT_PICK_MARGIN_PERCENT"
	envHumanStop      = "ACORN_AGENT_HUMAN_STOP_PERCENT"
	envReviewProblem  = "ACORN_AGENT_REVIEW_PROBLEM_PERCENT"
	envAdvanceMatch   = "ACORN_AGENT_ADVANCE_PERCENT"
	envAdvanceNone    = "ACORN_AGENT_ADVANCE_NONE_MAX_PERCENT"
	envAdvanceTop     = "ACORN_AGENT_ADVANCE_TOP_MIN_PERCENT"
	envAdvanceMargin  = "ACORN_AGENT_ADVANCE_MARGIN_PERCENT"
	envOverridePasses = "ACORN_AGENT_STOP_OVERRIDE_PASSES"
	envStopConfirm    = "ACORN_AGENT_STOP_CONFIRM_PERCENT"
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
	envRepeatSteps   = "ACORN_AGENT_REPEAT_STEPS"
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

// number reads a decimal setting, such as a price per million tokens; a value that is not a number is the fallback.
func number(name string, fallback float64) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(config.Env(name, "")), 64)
	if err != nil || value < 0 {
		return fallback
	}
	return value
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
	cfg.DonePasses = config.EnvInt(envDonePasses, cfg.DonePasses)
	cfg.DoneConfirm = percent(envDoneConfirm, cfg.DoneConfirm)
	cfg.MaxActions = config.EnvInt(envMaxActions, cfg.MaxActions)
	cfg.ChunkActions = config.EnvInt(envChunkActions, cfg.ChunkActions)
	cfg.CheckMatch = percent(envCheckMatch, cfg.CheckMatch)
	cfg.CheckBlocked = percent(envCheckBlocked, cfg.CheckBlocked)
	cfg.CheckLoading = percent(envCheckLoading, cfg.CheckLoading)
	cfg.OptionMatch = percent(envOptionMatch, cfg.OptionMatch)
	cfg.VetBlock = percent(envVetBlock, 0.3)
	cfg.VetClickBlock = percent(envVetClickBlock, 0.6)
	cfg.SingleSignOnBlock = percent(envSignOnBlock, 0.5)
	cfg.AccountAttempts = config.EnvInt(envAccountTries, cfg.AccountAttempts)
	cfg.MaxPrefills = config.EnvInt(envMaxPrefills, cfg.MaxPrefills)
	cfg.MaxReviews = config.EnvInt(envMaxReviews, cfg.MaxReviews)
	cfg.MaxAdvances = config.EnvInt(envMaxAdvances, cfg.MaxAdvances)
	cfg.MaxPicks = config.EnvInt(envMaxPicks, cfg.MaxPicks)
	cfg.PickMatch = percent(envPickMatch, cfg.PickMatch)
	cfg.PickMargin = percent(envPickMargin, cfg.PickMargin)
	cfg.HumanStop = percent(envHumanStop, cfg.HumanStop)
	cfg.ReviewErrors = percent(envReviewProblem, cfg.ReviewErrors)
	cfg.AdvanceMatch = percent(envAdvanceMatch, cfg.AdvanceMatch)
	cfg.AdvanceNoneMax = percent(envAdvanceNone, cfg.AdvanceNoneMax)
	cfg.AdvanceTopMin = percent(envAdvanceTop, cfg.AdvanceTopMin)
	cfg.AdvanceMargin = percent(envAdvanceMargin, cfg.AdvanceMargin)
	cfg.StopOverridePasses = config.EnvInt(envOverridePasses, cfg.StopOverridePasses)
	cfg.StopConfirm = percent(envStopConfirm, cfg.StopConfirm)
	cfg.KeepTurns = config.EnvInt(envKeepTurns, cfg.KeepTurns)
	cfg.KeepImages = config.EnvInt(envKeepImages, cfg.KeepImages)
	cfg.MaxStale = config.EnvInt(envMaxStale, cfg.MaxStale)
	cfg.RepeatSteps = config.EnvInt(envRepeatSteps, cfg.RepeatSteps)
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
	// A run whose profile holds an OpenAI key is driven on it, directly: OpenRouter caps a new account at 20 requests
	// a minute for the model, and OpenAI does not. The checks and the choices stay on OpenRouter's decision model.
	if !isOff(config.Env(envOpenAI, "")) {
		openAIModel := config.Env(envOpenAIModel, defaultOpenAIModel)
		openAIURL := config.Env(envOpenAIBaseURL, defaultOpenAIBaseURL)
		prices := llm.Prices{
			Input:      number(envOpenAIPriceInput, defaultOpenAIPriceInput),
			Cached:     number(envOpenAIPriceCached, defaultOpenAIPriceCached),
			CacheWrite: number(envOpenAIPriceCacheWrite, defaultOpenAIPriceCacheWrite),
			Output:     number(envOpenAIPriceOutput, defaultOpenAIPriceOutput),
		}
		a.WithOpenAI(func(key string) llm.Model { return llm.NewOpenAI(key, openAIModel, openAIURL, reasoning, prices) })
	}
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
