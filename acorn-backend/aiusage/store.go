// Package aiusage stores one row per model call, scoped to a Chrome tab.
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
	collectionName   = "acorn_ai_usage"
	listLimit        = 100
	adminListLimit   = 200
	adminSummaryPage = 50
)

var noBodyProjection = bson.M{"request": 0, "response": 0}

// Entry is one model call on one tab.
type Entry struct {
	ID               string `bson:"_id"`
	AccountID        string `bson:"accountId"`
	TabKey           string `bson:"tabKey"`
	Model            string `bson:"model"`
	PromptTokens     int    `bson:"promptTokens"`
	CompletionTokens int    `bson:"completionTokens"`
	// CachedTokens and CacheWriteTokens are the parts of PromptTokens read from
	// and written to the provider's prompt cache (billed at their own rates).
	CachedTokens     int       `bson:"cachedTokens,omitempty"`
	CacheWriteTokens int       `bson:"cacheWriteTokens,omitempty"`
	TotalTokens      int       `bson:"totalTokens"`
	CostNanos        int64     `bson:"costNanos"`
	Priced           bool      `bson:"priced"`
	DurationMs       int64     `bson:"durationMs"`
	Request          string    `bson:"request,omitempty"`
	Response         string    `bson:"response,omitempty"`
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

// Record inserts one call and returns it. An empty tab key is not a tab's
// history, and a call with nothing to show is not kept: both return an Entry
// with no ID.
func (s *Store) Record(ctx context.Context, accountID, tabKey string, usage openai.Usage) (Entry, error) {
	if s == nil || s.coll == nil || accountID == "" || tabKey == "" {
		return Entry{}, nil
	}
	if usage.TotalTokens == 0 && !usage.Priced && usage.Request == "" && usage.Error == "" {
		return Entry{}, nil
	}
	entry := Entry{
		ID:               bson.NewObjectID().Hex(),
		AccountID:        accountID,
		TabKey:           tabKey,
		Model:            usage.Model,
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		CachedTokens:     usage.CachedTokens,
		CacheWriteTokens: usage.CacheWriteTokens,
		TotalTokens:      usage.TotalTokens,
		CostNanos:        usage.CostNanos,
		Priced:           usage.Priced,
		DurationMs:       usage.Duration.Milliseconds(),
		Request:          usage.Request,
		Response:         usage.Response,
		Error:            usage.Error,
		CreatedAt:        time.Now().UTC(),
	}
	if _, err := s.coll.InsertOne(ctx, entry); err != nil {
		return Entry{}, err
	}
	return entry, nil
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
		SetProjection(bson.M{"request": 0, "response": 0}))
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

// AccountSummary is token and cost totals for one account (admin views).
type AccountSummary struct {
	AccountID      string    `bson:"accountId"`
	CallCount      int64     `bson:"callCount"`
	TotalCostNanos int64     `bson:"totalCostNanos"`
	TotalTokens    int64     `bson:"totalTokens"`
	LastCallAt     time.Time `bson:"lastCallAt"`
}

// ListByAccount is recent calls for one account across tabs, without request/response bodies.
func (s *Store) ListByAccount(ctx context.Context, accountID string, limit int) ([]Entry, error) {
	if s == nil || s.coll == nil || accountID == "" {
		return nil, nil
	}
	if limit <= 0 || limit > adminListLimit {
		limit = adminListLimit
	}
	cursor, err := s.coll.Find(ctx, bson.M{"accountId": accountID}, options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: -1}}).
		SetLimit(int64(limit)).
		SetProjection(noBodyProjection))
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

// SummarizeAccount totals priced calls for one account.
func (s *Store) SummarizeAccount(ctx context.Context, accountID string) (AccountSummary, error) {
	if s == nil || s.coll == nil || accountID == "" {
		return AccountSummary{}, nil
	}
	cursor, err := s.coll.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"accountId": accountID}}},
		{{Key: "$group", Value: bson.M{
			"_id":            "$accountId",
			"callCount":      bson.M{"$sum": 1},
			"totalCostNanos": bson.M{"$sum": "$costNanos"},
			"totalTokens":    bson.M{"$sum": "$totalTokens"},
			"lastCallAt":     bson.M{"$max": "$createdAt"},
		}}},
	})
	if err != nil {
		return AccountSummary{}, err
	}
	defer cursor.Close(ctx)
	var rows []AccountSummary
	if err := cursor.All(ctx, &rows); err != nil {
		return AccountSummary{}, err
	}
	if len(rows) == 0 {
		return AccountSummary{AccountID: accountID}, nil
	}
	rows[0].AccountID = accountID
	return rows[0], nil
}

// ListAccountSummaries returns usage totals per account, newest activity first.
func (s *Store) ListAccountSummaries(ctx context.Context, skip, limit int) ([]AccountSummary, error) {
	if s == nil || s.coll == nil {
		return nil, nil
	}
	if limit <= 0 || limit > adminSummaryPage {
		limit = adminSummaryPage
	}
	if skip < 0 {
		skip = 0
	}
	cursor, err := s.coll.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$group", Value: bson.M{
			"_id":            "$accountId",
			"callCount":      bson.M{"$sum": 1},
			"totalCostNanos": bson.M{"$sum": "$costNanos"},
			"totalTokens":    bson.M{"$sum": "$totalTokens"},
			"lastCallAt":     bson.M{"$max": "$createdAt"},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "lastCallAt", Value: -1}}}},
		{{Key: "$skip", Value: skip}},
		{{Key: "$limit", Value: limit}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var rows []struct {
		ID             string    `bson:"_id"`
		CallCount      int64     `bson:"callCount"`
		TotalCostNanos int64     `bson:"totalCostNanos"`
		TotalTokens    int64     `bson:"totalTokens"`
		LastCallAt     time.Time `bson:"lastCallAt"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	out := make([]AccountSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, AccountSummary{
			AccountID:      row.ID,
			CallCount:      row.CallCount,
			TotalCostNanos: row.TotalCostNanos,
			TotalTokens:    row.TotalTokens,
			LastCallAt:     row.LastCallAt,
		})
	}
	return out, nil
}
