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

// sourcePrefill marks a trace entry the quick text pass made (agent.sourcePrefill).
const sourcePrefill = "prefill"

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
	// Where the call went, for comparing providers: the API, who answered (OpenRouter's provider), the model, the
	// request's size, and whether the cost was reported or priced from rates.
	Provider   string `json:"provider"`
	Served     string `json:"served"`
	Model      string `json:"model"`
	RequestKB  int    `json:"requestKb"`
	CostSource string `json:"costSource"`
}

// group is the driving model's calls to one provider, and who answered them.
type group struct {
	latencies           []int64
	in, out, cached, kb int
	cost                float64
	priced              int
}

func (g *group) add(c call) {
	g.latencies = append(g.latencies, c.LatencyMs)
	g.in += c.Usage.InputTokens
	g.out += c.Usage.OutputTokens
	g.cached += c.Usage.CachedTokens
	g.kb += c.RequestKB
	g.cost += c.Usage.Cost
	if c.CostSource == "priced" {
		g.priced++
	}
}

// groupKey names where a call went. A call from before the trace recorded it went to OpenRouter.
func groupKey(c call) string {
	provider := c.Provider
	if provider == "" {
		provider = "openrouter"
	}
	served := c.Served
	if served == "" {
		served = "-"
	}
	return provider + " / " + served + " / " + c.Model
}

// groups are every run's driving-model calls so far, by where they went.
var groups = map[string]*group{}

func percentile(sorted []int64, q float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	return sorted[min(len(sorted)-1, int(float64(len(sorted))*q))]
}

// printGroups is the comparison of providers: how long a call took, what it cost, and how much it carried. The
// latency is the call's whole time as the agent saw it, so it includes the network to the provider.
func printGroups(title string, groups map[string]*group) {
	if len(groups) == 0 {
		return
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	fmt.Printf("  %s\n", title)
	fmt.Printf("    %-52s %5s %8s %8s %9s %8s %7s %7s\n", "provider / served by / model", "calls", "median s", "p90 s", "$/call", "in/call", "cached", "KB/call")
	for _, key := range keys {
		g := groups[key]
		sorted := append([]int64(nil), g.latencies...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
		n := len(sorted)
		cachedShare := 0.0
		if g.in > 0 {
			cachedShare = 100 * float64(g.cached) / float64(g.in)
		}
		note := ""
		if g.priced > 0 {
			note = "  (cost priced from rates)"
		}
		fmt.Printf("    %-52s %5d %8.1f %8.1f %9.5f %8d %6.0f%% %7d%s\n", key, n,
			float64(percentile(sorted, 0.5))/1000, float64(percentile(sorted, 0.9))/1000, per(g.cost, n), perInt(g.in, n), cachedShare, perInt(g.kb, n), note)
	}
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
	var model, screen, prefill tally
	runGroups := map[string]*group{}
	outcomes := map[string]int{}
	reviews, advances := 0, 0
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
		switch e.Source {
		case "review":
			reviews++
		case "advance":
			advances++
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
			key := groupKey(c)
			for _, into := range []map[string]*group{runGroups, groups} {
				if into[key] == nil {
					into[key] = &group{}
				}
				into[key].add(c)
			}
			if e.Source == sourcePrefill {
				prefill.add(c)
				continue
			}
			model.add(c)
			lastLatency += time.Duration(c.LatencyMs) * time.Millisecond
		}
	}
	wall := last.Sub(first) + lastLatency
	rest := wall - model.latency - screen.latency - prefill.latency
	fmt.Printf("%s\n", filepath.Base(dir))
	fmt.Printf("  wall %s over %d entries, %d actions sent, %d failed model calls\n", wall.Round(time.Second), len(steps), actions, failures)
	fmt.Printf("  model:  %3d calls (%d repairs)  in %d (cached %d)  out %d  $%.4f  %s  (%.1fs/call, %d in/call)\n",
		model.calls, model.repairs, model.in, model.cached, model.out, model.cost, model.latency.Round(time.Second),
		per(model.latency.Seconds(), model.calls), perInt(model.in, model.calls))
	if reviews+advances > 0 {
		fmt.Printf("  DOM-first: %d reviews, %d advances (their decision-model calls are in checks)\n", reviews, advances)
	}
	if prefill.calls > 0 {
		fmt.Printf("  prefill: %2d calls  in %d (cached %d)  out %d  $%.4f  %s  (%.1fs/call)\n",
			prefill.calls, prefill.in, prefill.cached, prefill.out, prefill.cost, prefill.latency.Round(time.Second), per(prefill.latency.Seconds(), prefill.calls))
	}
	if screen.calls > 0 {
		fmt.Printf("  checks: %3d calls  in %d  $%.4f  %s  (%.2fs/call)  outcomes %v\n",
			screen.calls, screen.in, screen.cost, screen.latency.Round(time.Millisecond), per(screen.latency.Seconds(), screen.calls), outcomes)
	}
	fmt.Printf("  extension and waiting: %s   total cost $%.4f\n", rest.Round(time.Second), model.cost+screen.cost+prefill.cost)
	printGroups("driving-model calls by where they went:", runGroups)
	fmt.Println()
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
	if len(dirs) > 1 {
		printGroups("every run together, driving-model calls by where they went:", groups)
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
