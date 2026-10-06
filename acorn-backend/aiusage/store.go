// Package aiusage stores one row per billed model call, scoped to a Chrome tab.
package aiusage

import (
	"context"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/openai"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	collectionName = "acorn_ai_usage"
	listLimit      = 100
)

// Entry is one model call on one tab.
type Entry struct {
	ID               string    `bson:"_id"`
	AccountID        string    `bson:"accountId"`
	TabKey           string    `bson:"tabKey"`
	Model            string    `bson:"model"`
	PromptTokens     int       `bson:"promptTokens"`
	CompletionTokens int       `bson:"completionTokens"`
	TotalTokens      int       `bson:"totalTokens"`
	CostNanos        int64     `bson:"costNanos"`
	Priced           bool      `bson:"priced"`
	DurationMs       int64     `bson:"durationMs"`
	Request          string    `bson:"request,omitempty"`
	Error            string    `bson:"error,omitempty"`
	CreatedAt        time.Time `bson:"createdAt"`
}

// Store is the account's AI usage history.
type Store struct {
	coll *mongo.Collection
}

func NewStore(client *mongo.Client, database string) *Store {
	store := &Store{}
	if client != nil && database != "" {
		store.coll = client.Database(database).Collection(collectionName)
	}
	return store
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	if s == nil || s.coll == nil {
		return nil
	}
	_, err := s.coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "accountId", Value: 1},
			{Key: "tabKey", Value: 1},
			{Key: "createdAt", Value: -1},
		},
	})
	return err
}

// Record inserts one call. An empty tab key is not a tab's history.
func (s *Store) Record(ctx context.Context, accountID, tabKey string, usage openai.Usage) error {
	if s == nil || s.coll == nil || accountID == "" || tabKey == "" {
		return nil
	}
	if usage.TotalTokens == 0 && !usage.Priced && usage.Request == "" && usage.Error == "" {
		return nil
	}
	entry := Entry{
		ID:               bson.NewObjectID().Hex(),
		AccountID:        accountID,
		TabKey:           tabKey,
		Model:            usage.Model,
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		TotalTokens:      usage.TotalTokens,
		CostNanos:        usage.CostNanos,
		Priced:           usage.Priced,
		DurationMs:       usage.Duration.Milliseconds(),
		Request:          usage.Request,
		Error:            usage.Error,
		CreatedAt:        time.Now().UTC(),
	}
	_, err := s.coll.InsertOne(ctx, entry)
	return err
}

// List is the newest calls for this account and tab, plus the sum of every priced call on that tab.
func (s *Store) List(ctx context.Context, accountID, tabKey string) ([]Entry, int64, error) {
	if s == nil || s.coll == nil || accountID == "" || tabKey == "" {
		return nil, 0, nil
	}
	filter := bson.M{"accountId": accountID, "tabKey": tabKey}
	cursor, err := s.coll.Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: -1}}).
		SetLimit(listLimit).
		SetProjection(bson.M{"request": 0}))
	if err != nil {
		return nil, 0, err
	}
	defer cursor.Close(ctx)
	var entries []Entry
	if err := cursor.All(ctx, &entries); err != nil {
		return nil, 0, err
	}
	total, err := s.sum(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	return entries, total, nil
}

func (s *Store) sum(ctx context.Context, filter bson.M) (int64, error) {
	cursor, err := s.coll.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$group", Value: bson.M{"_id": nil, "total": bson.M{"$sum": "$costNanos"}}}},
	})
	if err != nil {
		return 0, err
	}
	defer cursor.Close(ctx)
	var rows []struct {
		Total int64 `bson:"total"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return rows[0].Total, nil
}

// Get is one call, including the provider request, for this account only.
func (s *Store) Get(ctx context.Context, accountID, id string) (Entry, error) {
	if s == nil || s.coll == nil || accountID == "" || id == "" {
		return Entry{}, mongo.ErrNoDocuments
	}
	var entry Entry
	err := s.coll.FindOne(ctx, bson.M{"_id": id, "accountId": accountID}).Decode(&entry)
	return entry, err
}
