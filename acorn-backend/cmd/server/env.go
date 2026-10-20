package main

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/config"
)

const acornModule = "module github.com/sid0709/acorn/acorn-backend"

// loadAcornEnv reads acorn-backend/.env, walking up from the working directory
// until it finds that module. A .env in another folder is ignored.
// The production image has no source tree; Docker already injected /opt/acorn/deploy.env,
// so a missing module leaves the process environment as the config.
func loadAcornEnv() (string, error) {
	path, err := acornEnvPath()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("acorn-backend/.env not found at %s", path)
	}
	config.LoadEnvFileAt(path)
	return path, nil
}

func acornEnvPath() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if isAcornModule(dir) {
			return filepath.Join(dir, ".env"), nil
		}
		nested := filepath.Join(dir, "acorn-backend")
		if isAcornModule(nested) {
			return filepath.Join(nested, ".env"), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", nil
		}
		dir = parent
	}
}

func isAcornModule(dir string) bool {
	module, err := os.ReadFile(filepath.Join(dir, "go.mod"))
	if err != nil {
		return false
	}
	return strings.Contains(string(module), acornModule)
}

func mongoHost(uri string) string {
	parsed, err := url.Parse(uri)
	if err != nil {
		return ""
	}
	return parsed.Host
}

// envLogLevel names the setting that turns on the quiet lines (the extension's socket
// reconnecting, health checks, calls nobody records): "debug" shows them.
const envLogLevel = "ACORN_LOG_LEVEL"

// logLevel is how much the terminal shows: ordinary news, or everything with ACORN_LOG_LEVEL=debug.
func logLevel() slog.Level {
	if strings.EqualFold(config.Env(envLogLevel, ""), "debug") {
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

// settingsFrom is the end of the sentence that says where the settings were read from.
func settingsFrom(envFile string) string {
	if envFile == "" {
		return ", with settings from the environment"
	}
	return ", with settings from " + envFile
}
