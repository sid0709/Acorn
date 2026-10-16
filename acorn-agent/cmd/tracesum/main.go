// Command tracesum reads the trace folders the agent writes (one per run) and prints what each
// run cost and where its time went: the driving model's calls, the decision model's checks,
// tokens (and how many the provider served from its cache), money and seconds. Run it on a
// folder after a real application to compare a change against an earlier run.
//
//	go run ./cmd/tracesum traces/<session>...     # given folders
//	go run ./cmd/tracesum                         # every folder under traces/
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const defaultTraces = "traces"

type entry struct {
	At      time.Time `json:"at"`
	Source  string    `json:"source"`
	Status  string    `json:"status"`
	Error   string    `json:"error"`
	Actions []struct {
		Kind string `json:"kind"`
	} `json:"actions"`
	Check *struct {
		Outcome string `json:"outcome"`
	} `json:"check"`
}

type call struct {
	Kind   string `json:"kind"`
	Repair bool   `json:"repair"`
	Usage  struct {
		InputTokens  int     `json:"inputTokens"`
		OutputTokens int     `json:"outputTokens"`
		CachedTokens int     `json:"cachedTokens"`
		Cost         float64 `json:"cost"`
	} `json:"usage"`
	LatencyMs int64 `json:"latencyMs"`
}

type tally struct {
	calls, repairs, in, out, cached int
	cost                            float64
	latency                         time.Duration
}

func (t *tally) add(c call) {
	t.calls++
	if c.Repair {
		t.repairs++
	}
	t.in += c.Usage.InputTokens
	t.out += c.Usage.OutputTokens
	t.cached += c.Usage.CachedTokens
	t.cost += c.Usage.Cost
	t.latency += time.Duration(c.LatencyMs) * time.Millisecond
}

func read(path string, into any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, into)
}

func summarize(dir string) error {
	steps, err := filepath.Glob(filepath.Join(dir, "[0-9][0-9][0-9].json"))
	if err != nil || len(steps) == 0 {
		return fmt.Errorf("no steps in %s", dir)
	}
	sort.Strings(steps)
	var model, screen tally
	outcomes := map[string]int{}
	actions, failures := 0, 0
	var first, last time.Time
	var lastLatency time.Duration
	for _, path := range steps {
		var e entry
		if err := read(path, &e); err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		if first.IsZero() {
			first = e.At
		}
		last, lastLatency = e.At, 0
		actions += len(e.Actions)
		if e.Error != "" {
			failures++
		}
		if e.Check != nil {
			outcomes[e.Check.Outcome]++
		}
		var calls []call
		if err := read(strings.TrimSuffix(path, ".json")+".model.json", &calls); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("read model calls of %s: %w", path, err)
		}
		for _, c := range calls {
			if c.Kind == "decision" {
				screen.add(c)
				continue
			}
			model.add(c)
			lastLatency += time.Duration(c.LatencyMs) * time.Millisecond
		}
	}
	wall := last.Sub(first) + lastLatency
	rest := wall - model.latency - screen.latency
	fmt.Printf("%s\n", filepath.Base(dir))
	fmt.Printf("  wall %s over %d entries, %d actions sent, %d failed model calls\n", wall.Round(time.Second), len(steps), actions, failures)
	fmt.Printf("  model:  %3d calls (%d repairs)  in %d (cached %d)  out %d  $%.4f  %s  (%.1fs/call, %d in/call)\n",
		model.calls, model.repairs, model.in, model.cached, model.out, model.cost, model.latency.Round(time.Second),
		per(model.latency.Seconds(), model.calls), perInt(model.in, model.calls))
	if screen.calls > 0 {
		fmt.Printf("  checks: %3d calls  in %d  $%.4f  %s  (%.2fs/call)  outcomes %v\n",
			screen.calls, screen.in, screen.cost, screen.latency.Round(time.Millisecond), per(screen.latency.Seconds(), screen.calls), outcomes)
	}
	fmt.Printf("  extension and waiting: %s   total cost $%.4f\n\n", rest.Round(time.Second), model.cost+screen.cost)
	return nil
}

func per(total float64, n int) float64 {
	if n == 0 {
		return 0
	}
	return total / float64(n)
}

func perInt(total, n int) int {
	if n == 0 {
		return 0
	}
	return total / n
}

func main() {
	dirs := os.Args[1:]
	if len(dirs) == 0 {
		found, _ := filepath.Glob(filepath.Join(defaultTraces, "*"))
		sort.Slice(found, func(i, j int) bool { return mtime(found[i]).Before(mtime(found[j])) })
		dirs = found
	}
	status := 0
	for _, dir := range dirs {
		if err := summarize(dir); err != nil {
			fmt.Fprintln(os.Stderr, err)
			status = 1
		}
	}
	os.Exit(status)
}

func mtime(path string) time.Time {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}
