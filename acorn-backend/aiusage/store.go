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
	collectionName = "acorn_ai_usage"
	listLimit      = 100
	adminListLimit = 200
)

// Status values: a call ended with an answer, failed, or was given up by the caller.
const (
	StatusOK        = "ok"
	StatusError     = "error"
	StatusCancelled = "cancelled"
)

// CallContext is who made a model call and from where, captured once per request.
type CallContext struct {
	AccountID string
	TabKey    string
	// Route is the HTTP pattern that made the call, e.g. "POST /acorn/qa".
	Route string
	// Feature is the product feature the route belongs to (see acornapi featureForRoute).
	Feature string
	// Client is "extension" or "web"; ClientVersion is the extension version when known.
	Client        string
	ClientVersion string
	// SupportBy is the admin email when the call ran in a support session.
	SupportBy string
}

// Entry is one model call. Every field the statistics read is always written, so a
// missing field never reads as a different value.
type Entry struct {
	ID            string `bson:"_id"`
	AccountID     string `bson:"accountId"`
	TabKey        string `bson:"tabKey"`
	Model         string `bson:"model"`
	Feature       string `bson:"feature"`
	Step          string `bson:"step"`
	Route         string `bson:"route"`
	Client        string `bson:"client"`
	ClientVersion string `bson:"clientVersion"`
	SupportBy     string `bson:"supportBy"`
	Status        string `bson:"status"`
	ErrorKind     string `bson:"errorKind"`
	Error         string `bson:"error"`
	HTTPStatus    int    `bson:"httpStatus"`
	Attempts      int    `bson:"attempts"`
	FinishReason  string `bson:"finishReason"`

	PromptTokens     int `bson:"promptTokens"`
	CompletionTokens int `bson:"completionTokens"`
	// CachedTokens and CacheWriteTokens are the parts of PromptTokens read from
	// and written to the provider's prompt cache (billed at their own rates).
	CachedTokens     int       `bson:"cachedTokens"`
	CacheWriteTokens int       `bson:"cacheWriteTokens"`
	TotalTokens      int       `bson:"totalTokens"`
	CostNanos        int64     `bson:"costNanos"`
	Priced           bool      `bson:"priced"`
	DurationMs       int64     `bson:"durationMs"`
	CreatedAt        time.Time `bson:"createdAt"`
}

// StatusOf is a call's outcome from its error kind.
func StatusOf(usage openai.Usage) string {
	switch {
	case usage.ErrorKind == openai.ErrorKindCancelled:
		return StatusCancelled
	case usage.Error != "":
		return StatusError
	}
	return StatusOK
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
	models := []mongo.IndexModel{
		{Keys: bson.D{
			{Key: "accountId", Value: 1},
			{Key: "tabKey", Value: 1},
			{Key: "createdAt", Value: -1},
		}},
		{Keys: bson.D{{Key: "accountId", Value: 1}, {Key: "createdAt", Value: -1}}},
		{Keys: bson.D{{Key: "createdAt", Value: -1}}},
		{Keys: bson.D{{Key: "createdAt", Value: -1}, {Key: "model", Value: 1}}},
		{Keys: bson.D{{Key: "createdAt", Value: -1}, {Key: "feature", Value: 1}}},
		{Keys: bson.D{{Key: "createdAt", Value: -1}, {Key: "status", Value: 1}}},
	}
	for _, model := range models {
		if _, err := s.coll.Indexes().CreateOne(ctx, model); err != nil {
			return err
		}
	}
	return nil
}

// Record inserts one call and returns it. A call with no account, or with
// nothing to show (no tokens, cost, error or time), is not kept and returns an
// Entry with no ID. A call with no tab is kept with an empty tab key.
func (s *Store) Record(ctx context.Context, call CallContext, usage openai.Usage) (Entry, error) {
	if s == nil || s.coll == nil || call.AccountID == "" {
		return Entry{}, nil
	}
	if usage.TotalTokens == 0 && !usage.Priced && usage.Error == "" && usage.Duration == 0 {
		return Entry{}, nil
	}
	entry := Entry{
		ID:               bson.NewObjectID().Hex(),
		AccountID:        call.AccountID,
		TabKey:           call.TabKey,
		Model:            usage.Model,
		Feature:          call.Feature,
		Step:             usage.Step,
		Route:            call.Route,
		Client:           call.Client,
		ClientVersion:    call.ClientVersion,
		SupportBy:        call.SupportBy,
		Status:           StatusOf(usage),
		ErrorKind:        usage.ErrorKind,
		Error:            usage.Error,
		HTTPStatus:       usage.HTTPStatus,
		Attempts:         usage.Attempts,
		FinishReason:     usage.FinishReason,
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		CachedTokens:     usage.CachedTokens,
		CacheWriteTokens: usage.CacheWriteTokens,
		TotalTokens:      usage.TotalTokens,
		CostNanos:        usage.CostNanos,
		Priced:           usage.Priced,
		DurationMs:       usage.Duration.Milliseconds(),
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
		SetLimit(listLimit))
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
