package runs

import (
	"context"
	"time"

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
	return &Store{db: &mongoBackend{coll: client.Database(database).Collection(collectionName)}, now: time.Now}
}

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
	return nil
}

type mongoBackend struct{ coll *mongo.Collection }

func (m *mongoBackend) insert(ctx context.Context, entry Entry) (bool, error) {
	if _, err := m.coll.InsertOne(ctx, entry); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
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
