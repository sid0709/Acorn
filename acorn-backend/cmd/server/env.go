package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/sid0709/OpenSeat/backend-core/config"
)

const acornModule = "module github.com/sid0709/OpenSeat/acorn-backend"

// loadAcornEnv reads acorn-backend/.env, walking up from the working directory
// until it finds that module. A .env in another folder, including backend-core, is ignored.
func loadAcornEnv() (string, error) {
	path, err := acornEnvPath()
	if err != nil {
		return "", err
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
			return "", fmt.Errorf("acorn-backend module not found from %s", dir)
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
