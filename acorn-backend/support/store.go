// Package support stores user-reported issues from the extension.
package support

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	collectionName       = "acorn_support_claims"
	StatusOpen           = "open"
	StatusTriaged        = "triaged"
	StatusClosed         = "closed"
	defaultListLimit     = 50
	claimRateLimitWindow = time.Hour
	maxClaimsPerWindow   = 12
)

// MaxScreenshotBytes is the largest PNG/JPEG the API accepts on a claim.
const MaxScreenshotBytes = 4 << 20

// MaxPageURLLen bounds the reported tab URL stored on a claim.
const MaxPageURLLen = 2048

// Claim is one support report with a page screenshot.
type Claim struct {
	ID                string    `bson:"_id"`
	AccountID         string    `bson:"accountId"`
	UserEmail         string    `bson:"userEmail"`
	UserName          string    `bson:"userName"`
	PageURL           string    `bson:"pageUrl"`
	PageTitle         string    `bson:"pageTitle"`
	ExtensionVersion  string    `bson:"extensionVersion,omitempty"`
	TabKey            string    `bson:"tabKey,omitempty"`
	Status            string    `bson:"status"`
	ScreenshotPNG     []byte    `bson:"screenshotPng,omitempty"`
	ScreenshotMIME    string    `bson:"screenshotMime"`
	CreatedAt         time.Time `bson:"createdAt"`
}

// Store persists support claims.
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
		{Keys: bson.D{{Key: "accountId", Value: 1}, {Key: "createdAt", Value: -1}}},
		{Keys: bson.D{{Key: "status", Value: 1}, {Key: "createdAt", Value: -1}}},
		{Keys: bson.D{{Key: "createdAt", Value: -1}}},
	}
	for _, model := range models {
		if _, err := s.coll.Indexes().CreateOne(ctx, model); err != nil {
			return err
		}
	}
	return nil
}

// Create inserts a claim when the account is under the rate limit.
func (s *Store) Create(ctx context.Context, claim Claim) (Claim, error) {
	if s == nil || s.coll == nil || claim.AccountID == "" {
		return Claim{}, mongo.ErrNoDocuments
	}
	since := time.Now().UTC().Add(-claimRateLimitWindow)
	count, err := s.coll.CountDocuments(ctx, bson.M{
		"accountId": claim.AccountID,
		"createdAt": bson.M{"$gte": since},
	})
	if err != nil {
		return Claim{}, err
	}
	if count >= maxClaimsPerWindow {
		return Claim{}, ErrRateLimited
	}
	if claim.ID == "" {
		claim.ID = bson.NewObjectID().Hex()
	}
	if claim.Status == "" {
		claim.Status = StatusOpen
	}
	if claim.CreatedAt.IsZero() {
		claim.CreatedAt = time.Now().UTC()
	}
	if _, err := s.coll.InsertOne(ctx, claim); err != nil {
		return Claim{}, err
	}
	return claim, nil
}

// List returns recent claims for the admin queue.
func (s *Store) List(ctx context.Context, status string, limit int) ([]Claim, error) {
	if s == nil || s.coll == nil {
		return nil, nil
	}
	if limit <= 0 || limit > defaultListLimit {
		limit = defaultListLimit
	}
	filter := bson.M{}
	if status != "" {
		filter["status"] = status
	}
	cursor, err := s.coll.Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: -1}}).
		SetLimit(int64(limit)).
		SetProjection(bson.M{"screenshotPng": 0}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var rows []Claim
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// Get loads one claim including its screenshot bytes.
func (s *Store) Get(ctx context.Context, id string) (Claim, error) {
	if s == nil || s.coll == nil || id == "" {
		return Claim{}, mongo.ErrNoDocuments
	}
	var row Claim
	err := s.coll.FindOne(ctx, bson.M{"_id": id}).Decode(&row)
	return row, err
}

// SetStatus updates triage state on a claim.
func (s *Store) SetStatus(ctx context.Context, id, status string) error {
	if s == nil || s.coll == nil || id == "" {
		return mongo.ErrNoDocuments
	}
	res, err := s.coll.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": status}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return mongo.ErrNoDocuments
	}
	return nil
}
