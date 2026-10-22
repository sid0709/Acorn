package mailwatch

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-backend/aiusage"
	"github.com/sid0709/acorn/acorn-backend/config"
	"github.com/sid0709/acorn/acorn-backend/jev"
	"github.com/sid0709/acorn/acorn-backend/mailbox"
	"github.com/sid0709/acorn/acorn-backend/openai"
	"github.com/sid0709/acorn/acorn-backend/selector"
	"golang.org/x/sync/errgroup"
)

// syncMailbox reads the INBOX mail that arrived since the mailbox's history cursor and labels the
// verification mail among it. The cursor moves only once every message has been dealt with, so a
// failed sync is retried from the same place.
func (s *Service) syncMailbox(ctx context.Context, t target) error {
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
	state, found, err := s.store.get(ctx, t.MailboxID)
	if err != nil {
		return err
	}
	if !found || state.HistoryID == "" {
		// A mailbox starts from now: mail that was already there is not labelled.
		historyID, err := s.gmail.ProfileHistoryID(ctx, grant.RefreshToken)
		if err != nil {
			return err
		}
		return s.store.setHistory(ctx, t, historyID)
	}

	ids, latest, err := s.newMessages(ctx, grant.RefreshToken, state.HistoryID)
	if errors.Is(err, mailbox.ErrHistoryExpired) {
		return s.resync(ctx, t, grant, state)
	}
	if err != nil {
		return err
	}
	if len(ids) > maxSyncMessages {
		slog.Warn("gmail burst cut to the newest messages", "account", t.AccountID, "mailbox", t.MailboxID,
			"arrived", len(ids), "kept", maxSyncMessages)
		ids = ids[len(ids)-maxSyncMessages:]
	}
	if err := s.process(ctx, t, grant, state, ids); err != nil {
		return err
	}
	return s.advance(ctx, t, state.HistoryID, latest)
}

// newMessages is the INBOX messages added since historyID, oldest first, and the mailbox's history
// cursor as of the last page.
func (s *Service) newMessages(ctx context.Context, refreshToken, historyID string) ([]string, string, error) {
	var ids []string
	seen := map[string]bool{}
	latest, pageToken := "", ""
	for {
		page, err := s.gmail.History(ctx, refreshToken, historyID, pageToken)
		if err != nil {
			return nil, "", err
		}
		for _, id := range page.MessageIDs {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		if page.HistoryID != "" {
			latest = page.HistoryID
		}
		if page.NextPageToken == "" {
			return ids, latest, nil
		}
		pageToken = page.NextPageToken
	}
}

// resync is the answer to a history cursor Gmail no longer has: the newest inbox mail of the last
// day is judged, then the cursor is set to where the mailbox is now. The cursor is read first, so
// mail that arrives while this runs is found by the next sync.
func (s *Service) resync(ctx context.Context, t target, grant mailbox.Grant, state row) error {
	historyID, err := s.gmail.ProfileHistoryID(ctx, grant.RefreshToken)
	if err != nil {
		return err
	}
	ids, err := s.gmail.RecentInboxIDs(ctx, grant.RefreshToken, time.Now().Add(-resyncWindow), resyncMessages)
	if err != nil {
		return err
	}
	slog.Info("gmail history expired: re-syncing recent mail", "account", t.AccountID, "mailbox", t.MailboxID, "messages", len(ids))
	if err := s.process(ctx, t, grant, state, ids); err != nil {
		return err
	}
	return s.store.setHistory(ctx, t, historyID)
}

// advance moves the cursor forward; it never moves back.
func (s *Service) advance(ctx context.Context, t target, current, latest string) error {
	if latest == "" || !historyAfter(latest, current) {
		return nil
	}
	return s.store.setHistory(ctx, t, latest)
}

func historyAfter(a, b string) bool {
	x, errX := strconv.ParseUint(a, 10, 64)
	y, errY := strconv.ParseUint(b, 10, 64)
	return errX == nil && errY == nil && x > y
}

// verdictOf is what became of one email.
type verdictOf struct {
	id    string
	done  bool
	label bool
	err   error
}

// process judges the messages that were not looked at before and labels the verification mail. It
// fails when a message could not be dealt with and may still be retried.
func (s *Service) process(ctx context.Context, t target, grant mailbox.Grant, state row, ids []string) error {
	fresh, err := s.store.unprocessed(ctx, t.MailboxID, ids)
	if err != nil {
		return err
	}
	if len(fresh) == 0 {
		return nil
	}
	doc, stored, err := s.profiles.Load(ctx, t.AccountID)
	if err != nil {
		return err
	}
	key := strings.TrimSpace(doc.OpenrouterApiKey)
	if !stored || key == "" {
		slog.Info("gmail mail not judged: the profile has no OpenRouter key", "account", t.AccountID,
			"mailbox", t.MailboxID, "messages", len(fresh))
		return nil
	}
	gateway := selector.New(jev.New(key))
	modelCtx := s.modelContext(ctx, t.AccountID)
	knownLabel := s.knownLabel(t.MailboxID, state)

	results := make([]verdictOf, len(fresh))
	group, groupCtx := errgroup.WithContext(modelCtx)
	group.SetLimit(messageConcurrency)
	for i, id := range fresh {
		group.Go(func() error {
			results[i] = s.judge(groupCtx, gateway, grant.RefreshToken, knownLabel, id)
			return nil
		})
	}
	_ = group.Wait()

	var toLabel, handled []string
	var failed int
	for _, result := range results {
		switch {
		case errors.Is(result.err, mailbox.ErrGmailAuth), errors.Is(result.err, mailbox.ErrGmailScope):
			return result.err
		case result.err != nil:
			if s.giveUp(t.MailboxID, result.id) {
				handled = append(handled, result.id)
				slog.Warn("gmail message given up on", "account", t.AccountID, "mailbox", t.MailboxID, "message", result.id)
			} else {
				failed++
			}
		case result.label:
			toLabel = append(toLabel, result.id)
		case result.done:
			handled = append(handled, result.id)
		}
	}
	labelled := 0
	if len(toLabel) > 0 {
		if err := s.applyLabel(ctx, t, grant.RefreshToken, toLabel); err != nil {
			failed += len(toLabel)
			slog.Warn("gmail label was not applied", "account", t.AccountID, "mailbox", t.MailboxID,
				"messages", len(toLabel), "error", err)
		} else {
			handled = append(handled, toLabel...)
			labelled = len(toLabel)
		}
	}
	if err := s.store.markProcessed(ctx, t.MailboxID, handled); err != nil {
		return err
	}
	slog.Info("gmail mail judged", "account", t.AccountID, "mailbox", t.MailboxID,
		"messages", len(fresh), "labelled", labelled, "failed", failed)
	if failed > 0 {
		return fmt.Errorf("%d of %d messages could not be judged", failed, len(fresh))
	}
	return nil
}

// judge reads one email and asks whether it exists to deliver a verification code or link. Its text
// stays in this function: it is neither stored nor logged.
func (s *Service) judge(ctx context.Context, gateway *selector.Gateway, refreshToken, knownLabel, id string) verdictOf {
	message, err := s.gmail.ReadText(ctx, refreshToken, id)
	if errors.Is(err, mailbox.ErrNotFound) {
		return verdictOf{id: id, done: true}
	}
	if err != nil {
		return verdictOf{id: id, err: err}
	}
	if knownLabel != "" && slices.Contains(message.LabelIDs, knownLabel) {
		return verdictOf{id: id, done: true}
	}
	verdict, err := gateway.ClassifyVerificationMail(ctx, selector.VerifyMail{
		From:    message.From.Name + " <" + message.From.Email + ">",
		Subject: message.Subject,
		Body:    plainText(message, bodyRunes),
	})
	if errors.Is(err, selector.ErrInvalid) {
		return verdictOf{id: id, done: true}
	}
	if err != nil {
		return verdictOf{id: id, err: err}
	}
	return verdictOf{id: id, done: true, label: verdict.Verification && verdict.Confidence >= s.cfg.MinConfidence}
}

// giveUp counts one more failure of a message and says whether it has failed enough to be dropped.
func (s *Service) giveUp(mailboxID, messageID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.attempts) >= maxTrackedAttempts {
		clear(s.attempts)
	}
	key := mailboxID + "\x00" + messageID
	s.attempts[key]++
	if s.attempts[key] >= maxMessageAttempts {
		delete(s.attempts, key)
		return true
	}
	return false
}

// applyLabel puts the label on the messages, creating it on first use. A label id that went stale
// (the person deleted the label) is looked up again once.
func (s *Service) applyLabel(ctx context.Context, t target, refreshToken string, ids []string) error {
	labelID, err := s.labelID(ctx, t, refreshToken)
	if err != nil {
		return err
	}
	err = s.gmail.AddLabelToMany(ctx, t.MailboxID, refreshToken, ids, labelID)
	if err == nil {
		return nil
	}
	if errors.Is(err, mailbox.ErrGmailAuth) || errors.Is(err, mailbox.ErrGmailScope) {
		return err
	}
	s.mu.Lock()
	delete(s.labels, t.MailboxID)
	s.mu.Unlock()
	fresh, findErr := s.gmail.EnsureLabel(ctx, refreshToken, config.VerifyMailLabel)
	if findErr != nil || fresh == labelID {
		return err
	}
	s.rememberLabel(ctx, t, fresh)
	return s.gmail.AddLabelToMany(ctx, t.MailboxID, refreshToken, ids, fresh)
}

// labelID is the id of the mailbox's verification label: from memory, from the state kept for the
// mailbox, or from Gmail, which creates the label when it is missing.
func (s *Service) labelID(ctx context.Context, t target, refreshToken string) (string, error) {
	s.mu.Lock()
	id := s.labels[t.MailboxID]
	s.mu.Unlock()
	if id != "" {
		return id, nil
	}
	if state, found, err := s.store.get(ctx, t.MailboxID); err == nil && found && state.LabelID != "" {
		s.mu.Lock()
		s.labels[t.MailboxID] = state.LabelID
		s.mu.Unlock()
		return state.LabelID, nil
	}
	id, err := s.gmail.EnsureLabel(ctx, refreshToken, config.VerifyMailLabel)
	if err != nil {
		return "", err
	}
	s.rememberLabel(ctx, t, id)
	return id, nil
}

func (s *Service) rememberLabel(ctx context.Context, t target, id string) {
	s.mu.Lock()
	s.labels[t.MailboxID] = id
	s.mu.Unlock()
	if err := s.store.setLabel(ctx, t, id); err != nil {
		slog.Warn("gmail label id was not saved", "account", t.AccountID, "mailbox", t.MailboxID, "error", err)
	}
}

// knownLabel is the label id if it is already known, so mail that has it can be skipped.
func (s *Service) knownLabel(mailboxID string, state row) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id := s.labels[mailboxID]; id != "" {
		return id
	}
	return state.LabelID
}

// modelContext makes every model call under it count against the account in the usage history, as
// the call of the server itself (there is no request or tab behind it).
func (s *Service) modelContext(ctx context.Context, accountID string) context.Context {
	if s.usage == nil {
		return ctx
	}
	route := usageRoutePoll
	if s.Push() {
		route = usageRoutePush
	}
	call := aiusage.CallContext{
		AccountID: accountID, Route: route,
		Feature: config.VerifyMailFeature, Client: config.VerifyMailClient,
	}
	return openai.WithRecorder(ctx, func(usage openai.Usage) {
		recordCtx, cancel := context.WithTimeout(context.Background(), usageWriteTimeout)
		defer cancel()
		if _, err := s.usage.Record(recordCtx, call, usage); err != nil {
			slog.Error("gmail verification usage not recorded", "error", err, "account", accountID)
		}
	})
}
