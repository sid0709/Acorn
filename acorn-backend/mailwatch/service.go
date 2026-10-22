// Package mailwatch labels arriving Gmail that delivers a verification code or link.
//
// A mailbox is noticed two ways. With GMAIL_PUSH_TOPIC set, Gmail publishes its changes to a
// Pub/Sub topic and a push subscription calls POST /acorn/gmail/push (real time; Pub/Sub needs a
// Google Cloud project with billing). Without it, the server reads each mailbox's history on a
// timer: a light users.history.list call, 2 Gmail quota units each. Both feed the same sync: read
// the INBOX messages added since the mailbox's history cursor, ask TypeSafe Jev whether each exists
// to deliver a verification code or link, and put the one label oak-verify-email on those that do.
//
// Nothing of an email is kept: its text is read into memory, judged, and dropped. What is stored is
// a history cursor per mailbox and the ids of the messages already looked at.
package mailwatch

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/acorn/acorn-backend/aiusage"
	"github.com/sid0709/acorn/acorn-backend/config"
	"github.com/sid0709/acorn/acorn-backend/mailbox"
	"github.com/sid0709/acorn/acorn-backend/openai"
	"github.com/sid0709/acorn/acorn-backend/profile"
)

const (
	// syncWorkers is how many mailboxes are synced at once.
	syncWorkers = 4
	// messageConcurrency is how many emails of one mailbox are read and judged at once.
	messageConcurrency = 4
	// renewEvery is how often watches are checked for renewal (push mode), and renewWithin how
	// close to its end a watch must be to be renewed. A watch lasts at most seven days.
	renewEvery  = 6 * time.Hour
	renewWithin = 24 * time.Hour
	// registerConcurrency is how many watches are registered at once when the server starts.
	registerConcurrency = 4
	// resyncWindow and resyncMessages bound the re-sync after Gmail no longer has a mailbox's
	// history cursor: only the newest inbox mail of the last day, at most this many messages.
	resyncWindow   = 24 * time.Hour
	resyncMessages = 25
	// maxSyncMessages bounds one sync. A burst of more new mail than this is cut to the newest.
	maxSyncMessages = 100
	// bodyRunes is how much of an email's plain text the model reads.
	bodyRunes = 3000
	// maxMessageAttempts is how many times one email may fail before it is given up on, so a
	// message the model cannot judge does not hold its mailbox's history cursor back for a week.
	maxMessageAttempts = 3
	maxTrackedAttempts = 10000
	// failureBackoffCap is the longest a mailbox that keeps failing waits between polls.
	failureBackoffCap = 15 * time.Minute
	// syncTimeout bounds one sync of one mailbox.
	syncTimeout = 2 * time.Minute
	// usageWriteTimeout bounds one usage insert, which runs after the model call returned.
	usageWriteTimeout = 10 * time.Second
	// Usage routes: what the usage history shows as the caller of the model call.
	usageRoutePush = "POST /acorn/gmail/push"
	usageRoutePoll = "POLL /acorn/gmail/history"
)

// ErrClosed is a notification that arrived after the service was shut down.
var ErrClosed = errors.New("mail watch is closed")

// Mailboxes is the connected Gmail mailboxes. *mailbox.Store is the real one.
type Mailboxes interface {
	ByAddress(ctx context.Context, email string) ([]mailbox.Owned, error)
	Modifiable(ctx context.Context) ([]mailbox.Owned, error)
	Grant(ctx context.Context, userID, mailboxID string) (mailbox.Grant, error)
}

// Profiles is the account profile, which holds the OpenRouter key. *profile.Store is the real one.
type Profiles interface {
	Load(ctx context.Context, accountID string) (profile.Document, bool, error)
}

// UsageRecorder keeps one model call. *aiusage.Store is the real one.
type UsageRecorder interface {
	Record(ctx context.Context, call aiusage.CallContext, usage openai.Usage) (aiusage.Entry, error)
}

// Options are what the service is built from.
type Options struct {
	Config    config.MailWatch
	Store     *Store
	Mailboxes Mailboxes
	Gmail     *mailbox.Google
	Profiles  Profiles
	// Usage is optional: without it model calls are not recorded.
	Usage UsageRecorder
}

// target is one mailbox and the account that owns it.
type target struct {
	AccountID string
	MailboxID string
	Email     string
}

func targetOf(owned mailbox.Owned) target {
	return target{AccountID: owned.AccountID, MailboxID: owned.Mailbox.ID, Email: owned.Mailbox.Email}
}

type runState struct{ dirty bool }

type failure struct {
	count int
	next  time.Time
}

// Service watches connected mailboxes and labels verification mail.
type Service struct {
	cfg       config.MailWatch
	store     *Store
	mailboxes Mailboxes
	gmail     *mailbox.Google
	profiles  Profiles
	usage     UsageRecorder
	push      *verifier

	ctx    context.Context
	cancel context.CancelFunc
	slots  chan struct{}
	wg     sync.WaitGroup

	mu       sync.Mutex
	running  map[string]*runState
	labels   map[string]string
	attempts map[string]int
	failures map[string]failure
}

// New builds the service. Call Start to begin watching.
func New(opts Options) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{
		cfg: opts.Config, store: opts.Store, mailboxes: opts.Mailboxes, gmail: opts.Gmail,
		profiles: opts.Profiles, usage: opts.Usage,
		ctx: ctx, cancel: cancel, slots: make(chan struct{}, syncWorkers),
		running: map[string]*runState{}, labels: map[string]string{},
		attempts: map[string]int{}, failures: map[string]failure{},
	}
	if opts.Config.Push() {
		s.push = newVerifier(opts.Config.Audience, opts.Config.ServiceAccount)
	}
	return s
}

// Push reports whether mail arrives by Gmail push (POST /acorn/gmail/push) and not by polling.
func (s *Service) Push() bool { return s != nil && s.cfg.Push() }

// Start begins watching: it registers the watches and keeps them renewed (push), or polls each
// mailbox's history (no topic).
func (s *Service) Start() {
	if s == nil {
		return
	}
	if s.Push() {
		slog.Info("Gmail push is on: arriving mail is labelled when Gmail notifies this server.")
		s.goRun(s.runPush)
		return
	}
	slog.Info("Gmail push is off (no GMAIL_PUSH_TOPIC): reading each mailbox's history to find arriving mail.",
		"every", s.cfg.PollInterval.String())
	s.goRun(s.runPoll)
}

// Close stops the timers and waits for the syncs in flight.
func (s *Service) Close() {
	if s == nil {
		return
	}
	s.cancel()
	s.wg.Wait()
}

func (s *Service) goRun(fn func()) {
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		fn()
	}()
}

// VerifyPush checks the OIDC token of a push call.
func (s *Service) VerifyPush(ctx context.Context, authorization string) error {
	if !s.Push() {
		return ErrUnauthorized
	}
	return s.push.verify(ctx, authorization, time.Now())
}

// Notify is a push notification for a Gmail address: every mailbox connected for it is synced. It
// returns once the syncs are queued.
func (s *Service) Notify(ctx context.Context, emailAddress string) error {
	if s.ctx.Err() != nil {
		return ErrClosed
	}
	owned, err := s.mailboxes.ByAddress(ctx, emailAddress)
	if err != nil {
		return err
	}
	for _, box := range owned {
		if box.Mailbox.CanModify {
			s.schedule(targetOf(box))
		}
	}
	return nil
}

// Connected starts watching a mailbox that was just connected, without failing the connection:
// push registers its watch, polling syncs it at once (which sets its starting point, so mail that
// was already there is not labelled).
func (s *Service) Connected(ctx context.Context, accountID, mailboxID, email string) {
	if s == nil {
		return
	}
	t := target{AccountID: accountID, MailboxID: mailboxID, Email: strings.ToLower(strings.TrimSpace(email))}
	if s.Push() {
		if err := s.Register(ctx, t); err != nil {
			slog.Warn("gmail watch was not registered", "account", t.AccountID, "mailbox", t.MailboxID, "error", err)
		}
		return
	}
	s.schedule(t)
}

// Disconnected stops watching a mailbox that is being disconnected and forgets its state. Call it
// before the mailbox's grant is deleted, which Gmail needs to stop the watch.
func (s *Service) Disconnected(ctx context.Context, accountID, mailboxID string) {
	if s == nil {
		return
	}
	if s.Push() {
		if grant, err := s.mailboxes.Grant(ctx, accountID, mailboxID); err == nil && grant.CanModify {
			if err := s.gmail.StopWatch(ctx, grant.RefreshToken); err != nil {
				slog.Warn("gmail watch was not stopped", "account", accountID, "mailbox", mailboxID, "error", err)
			}
		}
	}
	if err := s.store.delete(ctx, mailboxID); err != nil {
		slog.Warn("gmail watch state was not deleted", "account", accountID, "mailbox", mailboxID, "error", err)
	}
	s.forget(mailboxID)
}

func (s *Service) forget(mailboxID string) {
	s.mu.Lock()
	delete(s.labels, mailboxID)
	delete(s.failures, mailboxID)
	s.mu.Unlock()
}

// Register asks Gmail to publish the mailbox's INBOX changes to the topic (push mode). It is also
// the renewal: a watch lasts at most a week, and registering again extends it.
func (s *Service) Register(ctx context.Context, t target) error {
	grant, err := s.mailboxes.Grant(ctx, t.AccountID, t.MailboxID)
	if errors.Is(err, mailbox.ErrNotFound) {
		return s.store.delete(ctx, t.MailboxID)
	}
	if err != nil {
		return err
	}
	if !grant.CanModify {
		return nil
	}
	result, err := s.gmail.Watch(ctx, grant.RefreshToken, s.cfg.Topic)
	if err != nil {
		return err
	}
	return s.store.setWatch(ctx, t, result.Expiration, result.HistoryID)
}

// runPush registers every watch and keeps them renewed.
func (s *Service) runPush() {
	s.registerAll(false)
	ticker := time.NewTicker(renewEvery)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.renewExpiring()
		}
	}
}

// registerAll registers the watch of every mailbox that can apply labels, skipping those whose
// watch has a day or more to run.
func (s *Service) registerAll(force bool) {
	owned, err := s.mailboxes.Modifiable(s.ctx)
	if err != nil {
		slog.Error("gmail watches could not be registered: reading mailboxes failed", "error", err)
		return
	}
	sem := make(chan struct{}, registerConcurrency)
	var wg sync.WaitGroup
	for _, box := range owned {
		t := targetOf(box)
		if !force {
			if state, found, err := s.store.get(s.ctx, t.MailboxID); err == nil && found &&
				state.WatchExpiration.After(time.Now().Add(renewWithin)) {
				continue
			}
		}
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer func() { <-sem; wg.Done() }()
			ctx, cancel := context.WithTimeout(s.ctx, syncTimeout)
			defer cancel()
			if err := s.Register(ctx, t); err != nil {
				slog.Warn("gmail watch was not registered", "account", t.AccountID, "mailbox", t.MailboxID, "error", err)
			}
		}()
	}
	wg.Wait()
}

// renewExpiring registers again the watches that end within renewWithin.
func (s *Service) renewExpiring() {
	rows, err := s.store.expiring(s.ctx, time.Now().Add(renewWithin))
	if err != nil {
		slog.Error("gmail watches could not be renewed: reading them failed", "error", err)
		return
	}
	sem := make(chan struct{}, registerConcurrency)
	var wg sync.WaitGroup
	for _, state := range rows {
		t := target{AccountID: state.AccountID, MailboxID: state.MailboxID, Email: state.Email}
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer func() { <-sem; wg.Done() }()
			ctx, cancel := context.WithTimeout(s.ctx, syncTimeout)
			defer cancel()
			if err := s.Register(ctx, t); err != nil {
				slog.Warn("gmail watch was not renewed", "account", t.AccountID, "mailbox", t.MailboxID, "error", err)
			}
		}()
	}
	wg.Wait()
}

// runPoll reads each mailbox's history every PollInterval, the mailboxes staggered across the
// interval so they do not all fire at once.
func (s *Service) runPoll() {
	s.pollOnce()
	ticker := time.NewTicker(s.cfg.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.pollOnce()
		}
	}
}

func (s *Service) pollOnce() {
	owned, err := s.mailboxes.Modifiable(s.ctx)
	if err != nil {
		slog.Error("gmail polling could not read the mailboxes", "error", err)
		return
	}
	for i, box := range owned {
		t := targetOf(box)
		delay := s.cfg.PollInterval * time.Duration(i) / time.Duration(len(owned))
		time.AfterFunc(delay, func() {
			if s.ctx.Err() == nil && s.due(t.MailboxID) {
				s.schedule(t)
			}
		})
	}
}

// due is false while a mailbox that keeps failing waits out its backoff.
func (s *Service) due(mailboxID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !time.Now().Before(s.failures[mailboxID].next)
}

// schedule syncs a mailbox on one of the worker slots. Mailboxes sync one at a time: a request for
// a mailbox that is already syncing makes it run once more when it is done.
func (s *Service) schedule(t target) {
	s.mu.Lock()
	if state, busy := s.running[t.MailboxID]; busy {
		state.dirty = true
		s.mu.Unlock()
		return
	}
	state := &runState{}
	s.running[t.MailboxID] = state
	s.mu.Unlock()
	s.goRun(func() { s.run(t, state) })
}

func (s *Service) run(t target, state *runState) {
	for {
		select {
		case s.slots <- struct{}{}:
		case <-s.ctx.Done():
			s.finish(t.MailboxID)
			return
		}
		ctx, cancel := context.WithTimeout(s.ctx, syncTimeout)
		err := s.syncMailbox(ctx, t)
		cancel()
		<-s.slots
		s.noteResult(t, err)

		s.mu.Lock()
		again := state.dirty && s.ctx.Err() == nil
		state.dirty = false
		if !again {
			delete(s.running, t.MailboxID)
		}
		s.mu.Unlock()
		if !again {
			return
		}
	}
}

func (s *Service) finish(mailboxID string) {
	s.mu.Lock()
	delete(s.running, mailboxID)
	s.mu.Unlock()
}

// noteResult keeps how many syncs of a mailbox failed in a row, so polling backs off from it.
func (s *Service) noteResult(t target, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err == nil {
		delete(s.failures, t.MailboxID)
		return
	}
	count := s.failures[t.MailboxID].count + 1
	wait := min(s.cfg.PollInterval<<min(count, 10), failureBackoffCap)
	s.failures[t.MailboxID] = failure{count: count, next: time.Now().Add(wait)}
	slog.Warn("gmail sync failed", "account", t.AccountID, "mailbox", t.MailboxID, "failures", count, "error", err)
}
