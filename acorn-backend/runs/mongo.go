package runs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/sid0709/acorn/acorn-backend/config"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const collectionName = "acorn_runs"

// NewStore keeps the Runs in MongoDB. Without a client or a database it keeps them in memory,
// which is how tests and a bare development server run.
func NewStore(client *mongo.Client, database string) *Store {
	if client == nil || database == "" {
		return NewMemory()
	}
	db := client.Database(database)
	return &Store{db: &mongoBackend{
		coll:        db.Collection(collectionName),
		screenshots: db.Collection(config.RunScreenshotsCollection),
	}, now: time.Now}
}

// screenshotRow is the stored image of one Run.
type screenshotRow struct {
	RunID     string    `bson:"runId"`
	AccountID string    `bson:"accountId"`
	MimeType  string    `bson:"mimeType"`
	Size      int       `bson:"size"`
	Bytes     []byte    `bson:"bytes"`
	CreatedAt time.Time `bson:"createdAt"`
}

const jpegMime = "image/jpeg"

// EnsureIndexes prepares the collection: one row per record of an account, and the two reads
// the website makes (the days, and the newest Runs).
func (s *Store) EnsureIndexes(ctx context.Context) error {
	mongoDB, ok := s.db.(*mongoBackend)
	if !ok {
		return nil
	}
	models := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "accountId", Value: 1}, {Key: "recordId", Value: 1}},
			Options: options.Index().SetUnique(true),
		},
		{Keys: bson.D{{Key: "accountId", Value: 1}, {Key: "day", Value: -1}}},
		{Keys: bson.D{{Key: "accountId", Value: 1}, {Key: "endedAt", Value: -1}}},
	}
	for _, model := range models {
		if _, err := mongoDB.coll.Indexes().CreateOne(ctx, model); err != nil {
			return err
		}
	}
	shotModels := []mongo.IndexModel{
		{Keys: bson.D{{Key: "runId", Value: 1}}, Options: options.Index().SetUnique(true)},
		{
			Keys:    bson.D{{Key: "createdAt", Value: 1}},
			Options: options.Index().SetExpireAfterSeconds(int32(config.RunScreenshotRetention / time.Second)),
		},
	}
	for _, model := range shotModels {
		if _, err := mongoDB.screenshots.Indexes().CreateOne(ctx, model); err != nil {
			return err
		}
	}
	return nil
}

type mongoBackend struct {
	coll        *mongo.Collection
	screenshots *mongo.Collection
}

func (m *mongoBackend) insert(ctx context.Context, entry Entry) (Entry, bool, error) {
	if _, err := m.coll.InsertOne(ctx, entry); err != nil {
		if !mongo.IsDuplicateKeyError(err) {
			return Entry{}, false, err
		}
		var stored Entry
		filter := bson.M{"accountId": entry.AccountID, "recordId": entry.RecordID}
		if err := m.coll.FindOne(ctx, filter).Decode(&stored); err != nil {
			return Entry{}, false, fmt.Errorf("load stored run: %w", err)
		}
		return stored, false, nil
	}
	return entry, true, nil
}

func (m *mongoBackend) putScreenshot(ctx context.Context, accountID, runID string, data []byte, at time.Time) error {
	owned := bson.M{"_id": runID, "accountId": accountID}
	if err := m.coll.FindOne(ctx, owned, options.FindOne().SetProjection(bson.M{"_id": 1})).Err(); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return ErrNotFound
		}
		return fmt.Errorf("find run: %w", err)
	}
	row := screenshotRow{RunID: runID, AccountID: accountID, MimeType: jpegMime, Size: len(data), Bytes: data, CreatedAt: at}
	if _, err := m.screenshots.ReplaceOne(ctx, bson.M{"runId": runID}, row, options.Replace().SetUpsert(true)); err != nil {
		return fmt.Errorf("store screenshot: %w", err)
	}
	if _, err := m.coll.UpdateOne(ctx, owned, bson.M{"$set": bson.M{"screenshotAt": at}}); err != nil {
		return fmt.Errorf("mark run: %w", err)
	}
	return nil
}

func (m *mongoBackend) screenshot(ctx context.Context, accountID, runID string) ([]byte, error) {
	var row screenshotRow
	err := m.screenshots.FindOne(ctx, bson.M{"runId": runID, "accountId": accountID}).Decode(&row)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load screenshot: %w", err)
	}
	return row.Bytes, nil
}

func (m *mongoBackend) daily(ctx context.Context, accountID, from, to string) ([]Day, error) {
	cursor, err := m.coll.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"accountId": accountID, "day": bson.M{"$gte": from, "$lte": to}}}},
		{{Key: "$group", Value: bson.M{
			"_id":        "$day",
			"count":      bson.M{"$sum": 1},
			"durationMs": bson.M{"$sum": "$durationMs"},
			"costNanos":  bson.M{"$sum": "$costNanos"},
		}}},
		{{Key: "$sort", Value: bson.M{"_id": 1}}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var rows []struct {
		Day        string `bson:"_id"`
		Count      int    `bson:"count"`
		DurationMs int64  `bson:"durationMs"`
		CostNanos  int64  `bson:"costNanos"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	days := make([]Day, 0, len(rows))
	for _, row := range rows {
		days = append(days, Day{Day: row.Day, Count: row.Count, DurationMs: row.DurationMs, CostNanos: row.CostNanos})
	}
	return days, nil
}

func (m *mongoBackend) recent(ctx context.Context, accountID string, limit int) ([]Entry, error) {
	cursor, err := m.coll.Find(ctx, bson.M{"accountId": accountID}, options.Find().
		SetSort(bson.D{{Key: "endedAt", Value: -1}}).
		SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var entries []Entry
	if err := cursor.All(ctx, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}
