package mailbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const (
	// historyPageSize is how many history records one history.list call returns (Gmail's maximum).
	historyPageSize = 500
	// maxBatchModify is how many messages one batchModify call may change (Gmail's maximum).
	maxBatchModify = 1000
	// labelVisible keeps a label in Gmail's label list and its messages in the message list.
	labelShow  = "labelShow"
	showInList = "show"
)

// ErrHistoryExpired is a history cursor Gmail no longer has (it keeps about a week), so the changes
// since it can no longer be listed and the mailbox must be re-synced from what is there now.
var ErrHistoryExpired = errors.New("gmail history is too old")

// WatchResult is what Gmail answers to users.watch: the mailbox's current history cursor, and when
// the watch stops delivering unless it is renewed.
type WatchResult struct {
	HistoryID  string
	Expiration time.Time
}

// Watch asks Gmail to publish this mailbox's INBOX changes to the Pub/Sub topic. Calling it again
// renews the watch (Gmail keeps one per account and project, and a watch lasts at most a week).
func (g *Google) Watch(ctx context.Context, refreshToken, topic string) (WatchResult, error) {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return WatchResult{}, err
	}
	body, err := g.post(ctx, access, "/watch", map[string]any{
		"topicName":           topic,
		"labelIds":            []string{LabelInbox},
		"labelFilterBehavior": "INCLUDE",
	})
	if err != nil {
		return WatchResult{}, fmt.Errorf("gmail watch: %w", err)
	}
	var raw struct {
		HistoryID  string `json:"historyId"`
		Expiration string `json:"expiration"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return WatchResult{}, fmt.Errorf("decode gmail watch: %w", err)
	}
	ms, _ := strconv.ParseInt(raw.Expiration, 10, 64)
	return WatchResult{HistoryID: raw.HistoryID, Expiration: time.UnixMilli(ms).UTC()}, nil
}

// StopWatch ends the mailbox's watch.
func (g *Google) StopWatch(ctx context.Context, refreshToken string) error {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return err
	}
	if _, err := g.post(ctx, access, "/stop", map[string]any{}); err != nil {
		return fmt.Errorf("gmail stop watch: %w", err)
	}
	return nil
}

// ProfileHistoryID is the mailbox's current history cursor.
func (g *Google) ProfileHistoryID(ctx context.Context, refreshToken string) (string, error) {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return "", err
	}
	body, err := g.get(ctx, access, "/profile", url.Values{"fields": {"historyId"}})
	if err != nil {
		return "", fmt.Errorf("gmail profile: %w", err)
	}
	var raw struct {
		HistoryID string `json:"historyId"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", fmt.Errorf("decode gmail profile: %w", err)
	}
	return raw.HistoryID, nil
}

// HistoryPage is one page of the INBOX messages added since a history cursor.
type HistoryPage struct {
	MessageIDs []string
	// HistoryID is the mailbox's history cursor as of this reply: the next sync starts from it.
	HistoryID     string
	NextPageToken string
}

// History lists the messages added to the INBOX after startHistoryID. A cursor Gmail no longer has
// answers ErrHistoryExpired.
func (g *Google) History(ctx context.Context, refreshToken, startHistoryID, pageToken string) (HistoryPage, error) {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return HistoryPage{}, err
	}
	params := url.Values{
		"startHistoryId": {startHistoryID},
		"historyTypes":   {"messageAdded"},
		"labelId":        {LabelInbox},
		"maxResults":     {strconv.Itoa(historyPageSize)},
		"fields":         {"history/messagesAdded/message/id,historyId,nextPageToken"},
	}
	if pageToken != "" {
		params.Set("pageToken", pageToken)
	}
	body, err := g.get(ctx, access, "/history", params)
	if isNotFound(err) {
		return HistoryPage{}, ErrHistoryExpired
	}
	if err != nil {
		return HistoryPage{}, fmt.Errorf("gmail history: %w", err)
	}
	var raw struct {
		History []struct {
			MessagesAdded []struct {
				Message struct {
					ID string `json:"id"`
				} `json:"message"`
			} `json:"messagesAdded"`
		} `json:"history"`
		HistoryID     string `json:"historyId"`
		NextPageToken string `json:"nextPageToken"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return HistoryPage{}, fmt.Errorf("decode gmail history: %w", err)
	}
	page := HistoryPage{HistoryID: raw.HistoryID, NextPageToken: raw.NextPageToken}
	for _, record := range raw.History {
		for _, added := range record.MessagesAdded {
			page.MessageIDs = append(page.MessageIDs, added.Message.ID)
		}
	}
	return page, nil
}

// RecentInboxIDs lists up to limit INBOX messages that arrived after since, newest first.
func (g *Google) RecentInboxIDs(ctx context.Context, refreshToken string, since time.Time, limit int) ([]string, error) {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return nil, err
	}
	body, err := g.get(ctx, access, "/messages", url.Values{
		"labelIds":   {LabelInbox},
		"q":          {"after:" + strconv.FormatInt(since.Unix(), 10)},
		"maxResults": {strconv.Itoa(limit)},
		"fields":     {"messages/id"},
	})
	if err != nil {
		return nil, fmt.Errorf("list recent gmail messages: %w", err)
	}
	var raw struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("decode recent gmail messages: %w", err)
	}
	ids := make([]string, len(raw.Messages))
	for i, message := range raw.Messages {
		ids[i] = message.ID
	}
	return ids, nil
}

// LabelID is the id of the user label called name; false when the mailbox has none.
func (g *Google) LabelID(ctx context.Context, refreshToken, name string) (string, bool, error) {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return "", false, err
	}
	return g.findLabel(ctx, access, name)
}

func (g *Google) findLabel(ctx context.Context, access, name string) (string, bool, error) {
	body, err := g.get(ctx, access, "/labels", url.Values{"fields": {"labels/id,labels/name,labels/type"}})
	if err != nil {
		return "", false, fmt.Errorf("list gmail labels: %w", err)
	}
	var raw struct {
		Labels []gmailLabel `json:"labels"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", false, fmt.Errorf("decode gmail labels: %w", err)
	}
	for _, label := range raw.Labels {
		if label.Type == labelUser && label.Name == name {
			return label.ID, true, nil
		}
	}
	return "", false, nil
}

// EnsureLabel is the id of the user label called name, created when the mailbox has none. Two
// workers can both find it missing; the one that loses the create gets a conflict, and reads the
// label the other made.
func (g *Google) EnsureLabel(ctx context.Context, refreshToken, name string) (string, error) {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return "", err
	}
	if id, found, err := g.findLabel(ctx, access, name); err != nil || found {
		return id, err
	}
	body, err := g.post(ctx, access, "/labels", map[string]string{
		"name":                  name,
		"labelListVisibility":   labelShow,
		"messageListVisibility": showInList,
	})
	if err != nil {
		var status *gmailStatusError
		if errors.As(err, &status) && status.status == http.StatusConflict {
			id, found, findErr := g.findLabel(ctx, access, name)
			if findErr != nil {
				return "", findErr
			}
			if found {
				return id, nil
			}
		}
		return "", fmt.Errorf("create gmail label: %w", err)
	}
	var created gmailLabel
	if err := json.Unmarshal(body, &created); err != nil || created.ID == "" {
		return "", fmt.Errorf("decode created gmail label: %w", err)
	}
	return created.ID, nil
}

// AddLabelToMany puts one label on every message in ids: one batchModify call per thousand, or a
// single modify for one message. A message that already has the label is left as it is.
func (g *Google) AddLabelToMany(ctx context.Context, mailboxID, refreshToken string, ids []string, labelID string) error {
	switch len(ids) {
	case 0:
		return nil
	case 1:
		return g.AddLabel(ctx, mailboxID, refreshToken, ids[0], labelID)
	}
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return err
	}
	for start := 0; start < len(ids); start += maxBatchModify {
		chunk := ids[start:min(start+maxBatchModify, len(ids))]
		if _, err := g.post(ctx, access, "/messages/batchModify", map[string]any{
			"ids":         chunk,
			"addLabelIds": []string{labelID},
		}); err != nil {
			return fmt.Errorf("gmail batch modify: %w", err)
		}
		for _, id := range chunk {
			key := mailboxID + "\x00" + id
			g.rows.delete(key)
			g.messages.delete(key)
		}
	}
	g.pages.deletePrefix(mailboxID + "\x00")
	g.labels.delete(mailboxID)
	return nil
}
