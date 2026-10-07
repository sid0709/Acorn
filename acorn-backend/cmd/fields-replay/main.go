// Command fields-replay runs field discovery over captured planner trees, so a
// change to how the text model lists a page's questions can be checked against
// pages already seen. Pass debug-run folders (or pure-tree files); each result is
// printed and saved as fields-replay.json beside its tree.
//
//	OPENROUTER_API_KEY=… go run ./cmd/fields-replay debug-runs/<run> …
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/backend-core/config"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	// openRouterKeyEnv holds the OpenRouter key the replay calls the text model with.
	openRouterKeyEnv = "OPENROUTER_API_KEY"
	// treeFileSuffix names a captured planner tree inside a debug-run folder.
	treeFileSuffix = "pure-tree.txt"
	resultFile     = "fields-replay.json"
	// maxLabelChars keeps one printed field on one line.
	maxLabelChars = 90
)

func main() {
	key := config.Env(openRouterKeyEnv, "")
	if key == "" || len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: %s=… go run ./cmd/fields-replay <debug-run or pure-tree> …\n", openRouterKeyEnv)
		os.Exit(2)
	}
	service := acorn.New(openai.OpenRouter(key))
	results := make([]string, len(os.Args)-1)
	var wg sync.WaitGroup
	for i, arg := range os.Args[1:] {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = replay(context.Background(), service, arg)
		}()
	}
	wg.Wait()
	fmt.Println(strings.Join(results, "\n"))
}

func replay(ctx context.Context, service *acorn.Service, arg string) string {
	tree, dir, err := readTree(arg)
	if err != nil {
		return fmt.Sprintf("== %s\n  error: %v", arg, err)
	}
	started := time.Now()
	fields, err := service.DiscoverFields(ctx, tree)
	if err != nil {
		return fmt.Sprintf("== %s\n  error: %v", arg, err)
	}
	if data, err := json.MarshalIndent(fields, "", "  "); err == nil {
		if err := os.WriteFile(filepath.Join(dir, resultFile), data, 0o600); err != nil {
			slog.Warn("fields-replay: result not saved", "dir", dir, "error", err)
		}
	}
	var out strings.Builder
	fmt.Fprintf(&out, "== %s  (%d fields, %s)\n", filepath.Base(dir), len(fields), time.Since(started).Round(time.Millisecond))
	for _, field := range fields {
		marks := ""
		if field.Required {
			marks += "*"
		}
		if field.Answered {
			marks += " answered"
		}
		fmt.Fprintf(&out, "  %5d %-8s %s%s", field.ElementIndex, field.Kind, clip(field.Label), marks)
		if len(field.Options) > 0 {
			fmt.Fprintf(&out, "  [%s]", strings.Join(field.Options, " / "))
		}
		if len(field.OptionIndexes) > 0 {
			fmt.Fprintf(&out, " @%v", field.OptionIndexes)
		}
		out.WriteString("\n")
	}
	return out.String()
}

// readTree reads a pure-tree file, or the one inside a debug-run folder.
func readTree(arg string) (string, string, error) {
	info, err := os.Stat(arg)
	if err != nil {
		return "", "", err
	}
	path := arg
	if info.IsDir() {
		matches, err := filepath.Glob(filepath.Join(arg, "*"+treeFileSuffix))
		if err != nil || len(matches) == 0 {
			return "", "", fmt.Errorf("no %s in %s", treeFileSuffix, arg)
		}
		path = matches[0]
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	return string(data), filepath.Dir(path), nil
}

func clip(text string) string {
	runes := []rune(text)
	if len(runes) <= maxLabelChars {
		return text
	}
	return string(runes[:maxLabelChars-1]) + "…"
}
