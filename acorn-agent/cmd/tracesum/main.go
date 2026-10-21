// Command tracesum reads the trace folders the agent writes (one per run) and prints what each
// run cost and where its time went: the driving model's calls, the decision model's checks,
// tokens (and how many the provider served from its cache), money and seconds. Run it on a
// folder after a real application to compare a change against an earlier run.
//
//	go run ./cmd/tracesum traces/<session>...     # given folders
//	go run ./cmd/tracesum                         # every folder under traces/
//	go run ./cmd/tracesum -json traces/<session>  # the same numbers as JSON, one object per folder
//
// With -json the output is a JSON array of Summary, for a tool that reads many runs (the live test
// runner, tests/e2e/live): how the run ended beside what it cost, so the text need not be parsed.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const defaultTraces = "traces"

// stop is why a run ended without being done, as the agent wrote it (agent.StopInfo).
type stop struct {
	Reason  string `json:"reason"`
	Kind    string `json:"kind,omitempty"`
	Problem string `json:"problem"`
	Action  string `json:"action"`
}

type entry struct {
	At         time.Time `json:"at"`
	DurationMs int64     `json:"durationMs"`
	Source     string    `json:"source"`
	Status     string    `json:"status"`
	Message    string    `json:"message"`
	Stop       *stop     `json:"stop"`
	// ReadyToSubmit marks the done entry of a run that stopped before sending the application.
	ReadyToSubmit bool   `json:"readyToSubmit"`
	URL           string `json:"url"`
	Error         string `json:"error"`
	Actions       []struct {
		Kind string `json:"kind"`
	} `json:"actions"`
	Check *struct {
		Outcome string `json:"outcome"`
	} `json:"check"`
}

// sessionFile is the run's start (session.json): when it began, where, and with which models.
type sessionFile struct {
	Started time.Time `json:"started"`
	Start   struct {
		URL              string `json:"url"`
		StopBeforeSubmit bool   `json:"stopBeforeSubmit"`
	} `json:"start"`
	Model       string `json:"model"`
	ScreenModel string `json:"screenModel"`
}

// Summary is one run's numbers, as -json prints them. Times are milliseconds, cost is dollars.
type Summary struct {
	Dir     string    `json:"dir"`
	Session string    `json:"session"`
	URL     string    `json:"url,omitempty"`
	Started time.Time `json:"started,omitempty"`
	Model   string    `json:"model,omitempty"`
	// StopBeforeSubmit is whether the run was asked to stop at the control that sends the application.
	StopBeforeSubmit bool  `json:"stopBeforeSubmit"`
	Entries          int   `json:"entries"`
	Actions          int   `json:"actions"`
	FailedCalls      int   `json:"failedCalls"`
	WallMs           int64 `json:"wallMs"`
	// The driving model's calls: how many, how many were repairs, the tokens read (and how many the
	// provider served from its cache), the tokens written, the cost and the time waited on it.
	ModelCalls     int     `json:"modelCalls"`
	Repairs        int     `json:"repairs"`
	InputTokens    int     `json:"inputTokens"`
	CachedTokens   int     `json:"cachedTokens"`
	OutputTokens   int     `json:"outputTokens"`
	ModelCost      float64 `json:"modelCost"`
	ModelLatencyMs int64   `json:"modelLatencyMs"`
	// The decision model's checks.
	Checks           int     `json:"checks"`
	CheckInputTokens int     `json:"checkInputTokens"`
	CheckCost        float64 `json:"checkCost"`
	CheckLatencyMs   int64   `json:"checkLatencyMs"`
	TotalCost        float64 `json:"totalCost"`
	// How the run ended: the last entry's status (working when it never ended), its line for the
	// person, whether a done stopped before sending, and the stop when there was one.
	Status        string `json:"status"`
	Message       string `json:"message"`
	ReadyToSubmit bool   `json:"readyToSubmit"`
	Stop          *stop  `json:"stop,omitempty"`
	// LastURL is the page the run ended on.
	LastURL string `json:"lastUrl,omitempty"`
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
	LatencyMs    int64  `json:"latencyMs"`
	Provider     string `json:"provider"`
	GenerationID string `json:"generationId"`
	// Requests times each HTTP request of the call (traces from v1.88 on).
	Requests []request `json:"requests"`
}

// request is one HTTP request of a call. The size and protocol fields come from traces that
// record the traffic (v1.89.4 on).
type request struct {
	BackoffMs       int64  `json:"backoffMs"`
	ConnectMs       int64  `json:"connectMs"`
	SendMs          int64  `json:"sendMs"`
	WaitMs          int64  `json:"waitMs"`
	ReadMs          int64  `json:"readMs"`
	Status          int    `json:"status"`
	Proto           string `json:"proto"`
	SendBytesPerSec int64  `json:"sendBytesPerSec"`
	RequestBytes    int64  `json:"requestBytes"`
	ResponseBytes   int64  `json:"responseBytes"`
	Body            *struct {
		SystemBytes       int64 `json:"systemBytes"`
		HistoryTextBytes  int64 `json:"historyTextBytes"`
		CurrentTextBytes  int64 `json:"currentTextBytes"`
		HistoryImages     int64 `json:"historyImages"`
		HistoryImageBytes int64 `json:"historyImageBytes"`
		CurrentImages     int64 `json:"currentImages"`
		CurrentImageBytes int64 `json:"currentImageBytes"`
	} `json:"body"`
}

// traffic sums what one model's requests sent and how fast, and keeps the largest.
type traffic struct {
	requests       int
	sent, received int64
	sendMs         int64
	protos         map[string]bool
	largest        request
}

func (t *traffic) add(r request) {
	if r.RequestBytes == 0 {
		return
	}
	t.requests++
	t.sent += r.RequestBytes
	t.received += r.ResponseBytes
	t.sendMs += r.SendMs
	if r.Proto != "" {
		if t.protos == nil {
			t.protos = map[string]bool{}
		}
		t.protos[r.Proto] = true
	}
	if r.RequestBytes > t.largest.RequestBytes {
		t.largest = r
	}
}

func (t *traffic) print(label string) {
	if t.requests == 0 {
		return
	}
	protos := make([]string, 0, len(t.protos))
	for proto := range t.protos {
		protos = append(protos, proto)
	}
	sort.Strings(protos)
	rate := int64(0)
	if t.sendMs > 0 {
		rate = t.sent * 1000 / t.sendMs
	}
	fmt.Printf("  %s: %d requests, %s sent, %s received, sending took %s (%s/s on average), protocol %s\n",
		label, t.requests, kb(t.sent), kb(t.received), (time.Duration(t.sendMs) * time.Millisecond).Round(time.Millisecond), kb(rate), orNone(strings.Join(protos, ",")))
	if body := t.largest.Body; body != nil {
		fmt.Printf("    largest request %s = system %s + text %s + %d images %s (%d of them history, %s)\n",
			kb(t.largest.RequestBytes), kb(body.SystemBytes), kb(body.HistoryTextBytes+body.CurrentTextBytes),
			body.HistoryImages+body.CurrentImages, kb(body.HistoryImageBytes+body.CurrentImageBytes),
			body.HistoryImages, kb(body.HistoryImageBytes))
	}
}

func kb(bytes int64) string { return fmt.Sprintf("%.0f KB", float64(bytes)/1024) }

// phases sums where the model calls' time went, request by request.
type phases struct {
	timed                              int
	backoff, connect, send, wait, read int64
	slowest                            []call
}

func (p *phases) add(c call) {
	if len(c.Requests) == 0 {
		return
	}
	p.timed++
	for _, r := range c.Requests {
		p.backoff += r.BackoffMs
		p.connect += r.ConnectMs
		p.send += r.SendMs
		p.wait += r.WaitMs
		p.read += r.ReadMs
	}
	p.slowest = append(p.slowest, c)
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

// run is everything read from one trace folder: the tallies the text prints, and the summary.
type run struct {
	model, screen     tally
	net               phases
	driving, deciding traffic
	server            time.Duration
	outcomes          map[string]int
	steps             int
	wall, rest        time.Duration
	summary           Summary
}

// collect reads one trace folder.
func collect(dir string) (run, error) {
	steps, err := filepath.Glob(filepath.Join(dir, "[0-9][0-9][0-9].json"))
	if err != nil || len(steps) == 0 {
		return run{}, fmt.Errorf("no steps in %s", dir)
	}
	sort.Strings(steps)
	r := run{outcomes: map[string]int{}, steps: len(steps)}
	r.summary = Summary{Dir: dir, Session: filepath.Base(dir), Entries: len(steps)}
	var session sessionFile
	if err := read(filepath.Join(dir, "session.json"), &session); err == nil {
		r.summary.URL, r.summary.Started, r.summary.Model = session.Start.URL, session.Started, session.Model
		r.summary.StopBeforeSubmit = session.Start.StopBeforeSubmit
	}
	var first, last time.Time
	var lastLatency time.Duration
	var ended entry
	for _, path := range steps {
		var e entry
		if err := read(path, &e); err != nil {
			return run{}, fmt.Errorf("read %s: %w", path, err)
		}
		if first.IsZero() {
			first = e.At
		}
		last, lastLatency = e.At, 0
		r.server += time.Duration(e.DurationMs) * time.Millisecond
		r.summary.Actions += len(e.Actions)
		if e.Error != "" {
			r.summary.FailedCalls++
		}
		if e.Check != nil {
			r.outcomes[e.Check.Outcome]++
		}
		// The last entry that answered says how the run ended; a failed step has no status.
		if e.Error == "" && e.Status != "" {
			ended = e
		}
		var calls []call
		if err := read(strings.TrimSuffix(path, ".json")+".model.json", &calls); err != nil && !os.IsNotExist(err) {
			return run{}, fmt.Errorf("read model calls of %s: %w", path, err)
		}
		for _, c := range calls {
			if c.Kind == "decision" {
				r.screen.add(c)
				for _, q := range c.Requests {
					r.deciding.add(q)
				}
				continue
			}
			for _, q := range c.Requests {
				r.driving.add(q)
			}
			r.model.add(c)
			r.net.add(c)
			lastLatency += time.Duration(c.LatencyMs) * time.Millisecond
		}
	}
	r.wall = last.Sub(first) + lastLatency
	r.rest = r.wall - r.model.latency - r.screen.latency
	s := &r.summary
	s.WallMs = r.wall.Milliseconds()
	s.ModelCalls, s.Repairs, s.InputTokens, s.CachedTokens, s.OutputTokens = r.model.calls, r.model.repairs, r.model.in, r.model.cached, r.model.out
	s.ModelCost, s.ModelLatencyMs = r.model.cost, r.model.latency.Milliseconds()
	s.Checks, s.CheckInputTokens, s.CheckCost, s.CheckLatencyMs = r.screen.calls, r.screen.in, r.screen.cost, r.screen.latency.Milliseconds()
	s.TotalCost = r.model.cost + r.screen.cost
	s.Status, s.Message, s.ReadyToSubmit, s.Stop, s.LastURL = ended.Status, ended.Message, ended.ReadyToSubmit, ended.Stop, ended.URL
	return r, nil
}

func summarize(dir string) error {
	r, err := collect(dir)
	if err != nil {
		return err
	}
	model, screen, net, driving, deciding := r.model, r.screen, r.net, r.driving, r.deciding
	server, outcomes, steps, wall, rest := r.server, r.outcomes, r.steps, r.wall, r.rest
	actions, failures := r.summary.Actions, r.summary.FailedCalls
	fmt.Printf("%s\n", filepath.Base(dir))
	fmt.Printf("  wall %s over %d entries, %d actions sent, %d failed model calls\n", wall.Round(time.Second), steps, actions, failures)
	fmt.Printf("  model:  %3d calls (%d repairs)  in %d (cached %d)  out %d  $%.4f  %s  (%.1fs/call, %d in/call)\n",
		model.calls, model.repairs, model.in, model.cached, model.out, model.cost, model.latency.Round(time.Second),
		per(model.latency.Seconds(), model.calls), perInt(model.in, model.calls))
	if screen.calls > 0 {
		fmt.Printf("  checks: %3d calls  in %d  $%.4f  %s  (%.2fs/call)  outcomes %v\n",
			screen.calls, screen.in, screen.cost, screen.latency.Round(time.Millisecond), per(screen.latency.Seconds(), screen.calls), outcomes)
	}
	fmt.Printf("  extension and waiting: %s   total cost $%.4f\n", rest.Round(time.Second), model.cost+screen.cost)
	if net.timed > 0 {
		ms := func(v int64) time.Duration { return time.Duration(v) * time.Millisecond }
		fmt.Printf("  model requests (%d timed): connect %s  send %s  provider wait %s  read %s  retry delays %s   server time %s\n",
			net.timed, ms(net.connect), ms(net.send), ms(net.wait), ms(net.read), ms(net.backoff), server.Round(time.Millisecond))
		sort.Slice(net.slowest, func(i, j int) bool { return net.slowest[i].LatencyMs > net.slowest[j].LatencyMs })
		for i, c := range net.slowest {
			if i == 3 {
				break
			}
			fmt.Printf("    slow call %dms  provider %s  generation %s  attempts %d  in %d (cached %d) out %d\n",
				c.LatencyMs, orNone(c.Provider), orNone(c.GenerationID), len(c.Requests), c.Usage.InputTokens, c.Usage.CachedTokens, c.Usage.OutputTokens)
		}
	}
	driving.print("driving model traffic")
	deciding.print("decision model traffic")
	fmt.Println()
	return nil
}

func orNone(text string) string {
	if text == "" {
		return "-"
	}
	return text
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
	asJSON := flag.Bool("json", false, "print one JSON object per folder instead of the text")
	flag.Parse()
	dirs := flag.Args()
	if len(dirs) == 0 {
		found, _ := filepath.Glob(filepath.Join(defaultTraces, "*"))
		sort.Slice(found, func(i, j int) bool { return mtime(found[i]).Before(mtime(found[j])) })
		dirs = found
	}
	status := 0
	if *asJSON {
		summaries := []Summary{}
		for _, dir := range dirs {
			r, err := collect(dir)
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				status = 1
				continue
			}
			summaries = append(summaries, r.summary)
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(summaries); err != nil {
			fmt.Fprintln(os.Stderr, err)
			status = 1
		}
		os.Exit(status)
	}
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
