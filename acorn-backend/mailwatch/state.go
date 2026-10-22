package mailwatch

import (
	"context"
	"errors"
	"time"

	"github.com/sid0709/acorn/acorn-backend/config"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// row is the state kept for one watched mailbox: a cursor into its history, when its Gmail watch
// ends (push mode), and the id of its verification label. It holds no token and no mail.
type row struct {
	MailboxID       string    `bson:"mailboxId"`
	AccountID       string    `bson:"accountId"`
	Email           string    `bson:"email"`
	HistoryID       string    `bson:"historyId"`
	WatchExpiration time.Time `bson:"watchExpiration"`
	LabelID         string    `bson:"labelId"`
	UpdatedAt       time.Time `bson:"updatedAt"`
}

type processedRow struct {
	MailboxID string    `bson:"mailboxId"`
	MessageID string    `bson:"messageId"`
	CreatedAt time.Time `bson:"createdAt"`
}

// Store keeps the watch state and the ids of the messages already looked at.
type Store struct {
	watches   *mongo.Collection
	processed *mongo.Collection
}

func NewStore(client *mongo.Client, database string) *Store {
	db := client.Database(database)
	return &Store{
		watches:   db.Collection(config.GmailWatchCollection),
		processed: db.Collection(config.GmailProcessedCollection),
	}
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	if _, err := s.watches.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "mailboxId", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "watchExpiration", Value: 1}}},
	}); err != nil {
		return err
	}
	_, err := s.processed.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "mailboxId", Value: 1}, {Key: "messageId", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "createdAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(int32(config.GmailProcessedRetention / time.Second))},
	})
	return err
}

// get is the mailbox's state; false when it has none yet.
func (s *Store) get(ctx context.Context, mailboxID string) (row, bool, error) {
	var found row
	err := s.watches.FindOne(ctx, bson.D{{Key: "mailboxId", Value: mailboxID}}).Decode(&found)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return row{}, false, nil
	}
	return found, err == nil, err
}

// setHistory moves the mailbox's cursor to historyID.
func (s *Store) setHistory(ctx context.Context, t target, historyID string) error {
	return s.upsert(ctx, t, bson.D{{Key: "historyId", Value: historyID}})
}

// setLabel remembers the id of the mailbox's verification label.
func (s *Store) setLabel(ctx context.Context, t target, labelID string) error {
	return s.upsert(ctx, t, bson.D{{Key: "labelId", Value: labelID}})
}

// setWatch records a registered Gmail watch. baseline is the cursor to start from, used only when
// the mailbox has none: a renewal must not move a cursor that has mail still to be read after it.
func (s *Store) setWatch(ctx context.Context, t target, expiration time.Time, baseline string) error {
	if err := s.upsert(ctx, t, bson.D{{Key: "watchExpiration", Value: expiration.UTC()}}); err != nil {
		return err
	}
	_, err := s.watches.UpdateOne(ctx,
		bson.D{{Key: "mailboxId", Value: t.MailboxID}, {Key: "$or", Value: bson.A{
			bson.D{{Key: "historyId", Value: bson.D{{Key: "$exists", Value: false}}}},
			bson.D{{Key: "historyId", Value: ""}},
		}}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "historyId", Value: baseline}}}},
	)
	return err
}

func (s *Store) upsert(ctx context.Context, t target, set bson.D) error {
	set = append(set,
		bson.E{Key: "accountId", Value: t.AccountID},
		bson.E{Key: "email", Value: t.Email},
		bson.E{Key: "updatedAt", Value: time.Now().UTC()},
	)
	_, err := s.watches.UpdateOne(ctx,
		bson.D{{Key: "mailboxId", Value: t.MailboxID}},
		bson.D{{Key: "$set", Value: set}},
		options.UpdateOne().SetUpsert(true),
	)
	return err
}

func (s *Store) delete(ctx context.Context, mailboxID string) error {
	if _, err := s.processed.DeleteMany(ctx, bson.D{{Key: "mailboxId", Value: mailboxID}}); err != nil {
		return err
	}
	_, err := s.watches.DeleteOne(ctx, bson.D{{Key: "mailboxId", Value: mailboxID}})
	return err
}

// expiring is the watches that end before the given time.
func (s *Store) expiring(ctx context.Context, before time.Time) ([]row, error) {
	cursor, err := s.watches.Find(ctx, bson.D{{Key: "watchExpiration", Value: bson.D{{Key: "$lt", Value: before.UTC()}}}})
	if err != nil {
		return nil, err
	}
	var rows []row
	err = cursor.All(ctx, &rows)
	return rows, err
}

// unprocessed is the ids that were not looked at before, in their order.
func (s *Store) unprocessed(ctx context.Context, mailboxID string, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	cursor, err := s.processed.Find(ctx,
		bson.D{{Key: "mailboxId", Value: mailboxID}, {Key: "messageId", Value: bson.D{{Key: "$in", Value: ids}}}},
		options.Find().SetProjection(bson.D{{Key: "messageId", Value: 1}}),
	)
	if err != nil {
		return nil, err
	}
	var seen []processedRow
	if err := cursor.All(ctx, &seen); err != nil {
		return nil, err
	}
	done := make(map[string]bool, len(seen))
	for _, row := range seen {
		done[row.MessageID] = true
	}
	fresh := make([]string, 0, len(ids))
	for _, id := range ids {
		if !done[id] {
			fresh = append(fresh, id)
		}
	}
	return fresh, nil
}

// markProcessed remembers message ids, never what was in them. An id already there is left alone.
func (s *Store) markProcessed(ctx context.Context, mailboxID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	now := time.Now().UTC()
	docs := make([]processedRow, len(ids))
	for i, id := range ids {
		docs[i] = processedRow{MailboxID: mailboxID, MessageID: id, CreatedAt: now}
	}
	_, err := s.processed.InsertMany(ctx, docs, options.InsertMany().SetOrdered(false))
	if err != nil && !isDuplicateOnly(err) {
		return err
	}
	return nil
}

// isDuplicateOnly is an unordered insert whose only failures were ids that were already there.
func isDuplicateOnly(err error) bool {
	var bulk mongo.BulkWriteException
	if !errors.As(err, &bulk) {
		return false
	}
	for _, failure := range bulk.WriteErrors {
		if failure.Code != duplicateKeyCode {
			return false
		}
	}
	return true
}

const duplicateKeyCode = 11000
