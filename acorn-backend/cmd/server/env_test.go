package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestAcornEnvPathFindsModule(t *testing.T) {
	path, err := acornEnvPath()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, filepath.Join("acorn-backend", ".env")) {
		t.Fatalf("path = %q", path)
	}
}

func TestLoadAcornEnvUsesProcessEnvironmentWithoutModule(t *testing.T) {
	t.Chdir(t.TempDir())
	path, err := loadAcornEnv()
	if err != nil {
		t.Fatal(err)
	}
	if path != "" {
		t.Fatalf("path = %q", path)
	}
}
