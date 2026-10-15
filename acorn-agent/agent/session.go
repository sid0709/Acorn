package agent

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
	"github.com/sid0709/OpenSeat/acorn-agent/llm"
)

// turn is one step of the run as the model lived it.
type turn struct {
	number int
	// text is what the model was told beside the screenshot; image is the screenshot.
	// image is dropped from older turns, text stays until the turn is folded into a summary.
	text  string
	image string
	// answer is the model's reply as JSON, replayed as its own earlier turn.
	answer string
	// summary is the one line that stands for the turn once it is folded away.
	summary string
}

// session is one application run: the applicant, the model's memory, and its history.
type session struct {
	id      string
	key     string // the person's OpenRouter key; held in memory only
	start   Start
	snap    applicant.Snapshot
	system  string
	created time.Time

	mu      sync.Mutex
	touched time.Time
	// seq counts every step asked, including the ones that failed, and names the trace files.
	seq   int
	step  int
	memo  string
	job   string
	turns []turn
	// folded holds one line per step that left the recent history, oldest first.
	folded []string
	// lastSig is the previous screenshot's signature, for telling whether the page changed.
	lastSig []uint8
	// stale counts steps in a row where the screen did not change.
	stale int
	// resume is the résumé chosen for this run, once chosen.
	resume string
	usage  Usage
	// finished is set once a step ended the run.
	finished bool
}

// Limits on what a session keeps.
const (
	// maxFoldedLines bounds the run's folded history.
	maxFoldedLines = 80
	// maxSummaryChars bounds one folded line.
	maxSummaryChars = 240
	// maxMemoChars bounds the model's scratchpad, which is replayed on every step.
	maxMemoChars = 2000
	// maxJobChars bounds the job description the model records.
	maxJobChars = 600
	// approxImageTokens is what a screenshot costs in the history budget.
	approxImageTokens = 1200
)

func newSessionID() (string, error) {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("make session id: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}

// history builds the model's view of the run before the current step: the folded summary,
// then the recent turns. Only the newest keepImages turns carry their screenshot. When the
// text still exceeds budget (in estimated tokens), the oldest turns are folded into the
// summary until it fits.
func (s *session) history(keepTurns, keepImages, budget int) []llm.Message {
	for len(s.turns) > keepTurns {
		s.fold()
	}
	for budgetUsed(s, keepImages) > budget && len(s.turns) > 1 {
		s.fold()
	}
	var out []llm.Message
	if len(s.folded) > 0 {
		out = append(out, llm.Message{
			Role: llm.RoleUser,
			Text: "Earlier in this run (oldest first; your notes below are the full picture):\n- " + strings.Join(s.folded, "\n- "),
		})
	}
	for i, t := range s.turns {
		message := llm.Message{Role: llm.RoleUser, Text: t.text}
		if i >= len(s.turns)-keepImages && t.image != "" {
			message.Images = []string{t.image}
		} else {
			message.Text += "\n(Screenshot no longer kept.)"
		}
		out = append(out, message, llm.Message{Role: llm.RoleAssistant, Text: t.answer})
	}
	return out
}

// fold moves the oldest turn into the summary lines.
func (s *session) fold() {
	if len(s.turns) == 0 {
		return
	}
	s.folded = append(s.folded, clipText(s.turns[0].summary, maxSummaryChars))
	if len(s.folded) > maxFoldedLines {
		s.folded = s.folded[len(s.folded)-maxFoldedLines:]
	}
	s.turns = s.turns[1:]
}

func budgetUsed(s *session, keepImages int) int {
	total := 0
	for i, t := range s.turns {
		total += (len(t.text) + len(t.answer)) / 4
		if i >= len(s.turns)-keepImages && t.image != "" {
			total += approxImageTokens
		}
	}
	for _, line := range s.folded {
		total += len(line) / 4
	}
	return total + len(s.system)/4
}

// store holds the live sessions. A session nobody has touched for ttl is dropped.
type store struct {
	mu       sync.Mutex
	sessions map[string]*session
	ttl      time.Duration
	now      func() time.Time
}

func newStore(ttl time.Duration, now func() time.Time) *store {
	return &store{sessions: map[string]*session{}, ttl: ttl, now: now}
}

func (st *store) add(s *session) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.sweepLocked()
	st.sessions[s.id] = s
}

func (st *store) get(id string) (*session, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.sweepLocked()
	s, ok := st.sessions[id]
	return s, ok
}

func (st *store) remove(id string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	delete(st.sessions, id)
}

func (st *store) len() int {
	st.mu.Lock()
	defer st.mu.Unlock()
	return len(st.sessions)
}

// sweepLocked drops sessions idle past the ttl. A session in the middle of a step holds
// its own lock and is never idle: touched moves on every step.
func (st *store) sweepLocked() {
	cutoff := st.now().Add(-st.ttl)
	for id, s := range st.sessions {
		if s.lastTouched().Before(cutoff) {
			delete(st.sessions, id)
		}
	}
}

func (s *session) lastTouched() time.Time {
	if s.mu.TryLock() {
		defer s.mu.Unlock()
		return s.touched
	}
	return time.Now() // busy: in the middle of a step
}
