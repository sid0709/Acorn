// Package support stores issues users report from the extension and the
// conversation between the reporter and support about each one.
package support

import (
	"context"
	"regexp"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	claimsCollection   = "acorn_support_claims"
	messagesCollection = "acorn_support_messages"

	// Claim statuses. A reporter's reply reopens a closed claim.
	StatusOpen   = "open"
	StatusClosed = "closed"

	// Message authors.
	AuthorUser  = "user"
	AuthorAdmin = "admin"

	adminListLimit       = 200
	userListLimit        = 100
	threadLimit          = 500
	claimRateLimitWindow = time.Hour
	maxClaimsPerWindow   = 12
	maxMessagesPerWindow = 120
)

// MaxScreenshotBytes is the largest full-page JPEG/PNG the API accepts on a claim.
const MaxScreenshotBytes = 8 << 20

// MaxPageURLLen bounds the reported tab URL stored on a claim.
const MaxPageURLLen = 2048

// MaxNotesLen and MaxMessageLen bound what a person types.
const (
	MaxNotesLen   = 2000
	MaxMessageLen = 4000
)

// Claim is one support report: the page, a full-page screenshot, the reporter's
// notes, and where the conversation stands.
type Claim struct {
	ID               string    `bson:"_id"`
	AccountID        string    `bson:"accountId"`
	UserEmail        string    `bson:"userEmail"`
	UserName         string    `bson:"userName"`
	PageURL          string    `bson:"pageUrl"`
	PageTitle        string    `bson:"pageTitle"`
	Notes            string    `bson:"notes"`
	ExtensionVersion string    `bson:"extensionVersion"`
	TabKey           string    `bson:"tabKey"`
	Status           string    `bson:"status"`
	Screenshot       []byte    `bson:"screenshot,omitempty"`
	ScreenshotMIME   string    `bson:"screenshotMime"`
	ScreenshotWidth  int       `bson:"screenshotWidth"`
	ScreenshotHeight int       `bson:"screenshotHeight"`
	MessageCount     int       `bson:"messageCount"`
	LastMessageAt    time.Time `bson:"lastMessageAt"`
	LastMessageBy    string    `bson:"lastMessageBy"`
	UserReadAt       time.Time `bson:"userReadAt"`
	AdminReadAt      time.Time `bson:"adminReadAt"`
	CreatedAt        time.Time `bson:"createdAt"`
	ClosedAt         time.Time `bson:"closedAt,omitempty"`
}

// UnreadFor reports whether the other side wrote after reader last looked.
func (c Claim) UnreadFor(reader string) bool {
	if c.LastMessageBy == "" || c.LastMessageBy == reader {
		return false
	}
	readAt := c.UserReadAt
	if reader == AuthorAdmin {
		readAt = c.AdminReadAt
	}
	return c.LastMessageAt.After(readAt)
}

// Message is one line in a claim's conversation.
type Message struct {
	ID         string    `bson:"_id"`
	ClaimID    string    `bson:"claimId"`
	AccountID  string    `bson:"accountId"`
	Author     string    `bson:"author"`
	AuthorName string    `bson:"authorName"`
	Body       string    `bson:"body"`
	CreatedAt  time.Time `bson:"createdAt"`
}

// Store persists claims and their messages.
type Store struct {
	claims   *mongo.Collection
	messages *mongo.Collection
}

func NewStore(client *mongo.Client, database string) *Store {
	store := &Store{}
	if client != nil && database != "" {
		db := client.Database(database)
		store.claims = db.Collection(claimsCollection)
		store.messages = db.Collection(messagesCollection)
	}
	return store
}

func (s *Store) ready() bool { return s != nil && s.claims != nil }

func (s *Store) EnsureIndexes(ctx context.Context) error {
	if !s.ready() {
		return nil
	}
	if _, err := s.claims.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "accountId", Value: 1}, {Key: "lastMessageAt", Value: -1}}},
		{Keys: bson.D{{Key: "status", Value: 1}, {Key: "lastMessageAt", Value: -1}}},
		{Keys: bson.D{{Key: "lastMessageAt", Value: -1}}},
	}); err != nil {
		return err
	}
	_, err := s.messages.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "claimId", Value: 1}, {Key: "createdAt", Value: 1}}},
		{Keys: bson.D{{Key: "accountId", Value: 1}, {Key: "createdAt", Value: -1}}},
	})
	return err
}

// Create inserts a claim when the account is under the rate limit.
func (s *Store) Create(ctx context.Context, claim Claim) (Claim, error) {
	if !s.ready() || claim.AccountID == "" {
		return Claim{}, ErrInvalidClaim
	}
	count, err := s.claims.CountDocuments(ctx, bson.M{
		"accountId": claim.AccountID,
		"createdAt": bson.M{"$gte": time.Now().UTC().Add(-claimRateLimitWindow)},
	})
	if err != nil {
		return Claim{}, err
	}
	if count >= maxClaimsPerWindow {
		return Claim{}, ErrRateLimited
	}
	now := time.Now().UTC()
	claim.ID = bson.NewObjectID().Hex()
	claim.Status = StatusOpen
	claim.CreatedAt = now
	claim.LastMessageAt = now
	claim.LastMessageBy = AuthorUser
	claim.UserReadAt = now
	if _, err := s.claims.InsertOne(ctx, claim); err != nil {
		return Claim{}, err
	}
	return claim, nil
}

var listProjection = bson.M{"screenshot": 0}

// ListForAccount is the reporter's own claims, latest conversation first.
func (s *Store) ListForAccount(ctx context.Context, accountID string) ([]Claim, error) {
	if !s.ready() || accountID == "" {
		return nil, nil
	}
	return s.find(ctx, bson.M{"accountId": accountID}, userListLimit)
}

// List is the admin queue: claims with this status (any when empty) whose
// reporter, page or notes contain query, latest conversation first.
func (s *Store) List(ctx context.Context, status, query string) ([]Claim, error) {
	if !s.ready() {
		return nil, nil
	}
	filter := bson.M{}
	if status != "" {
		filter["status"] = status
	}
	if query = strings.TrimSpace(query); query != "" {
		pattern := bson.Regex{Pattern: regexp.QuoteMeta(query), Options: "i"}
		filter["$or"] = bson.A{
			bson.M{"userName": pattern}, bson.M{"userEmail": pattern},
			bson.M{"pageUrl": pattern}, bson.M{"pageTitle": pattern}, bson.M{"notes": pattern},
		}
	}
	return s.find(ctx, filter, adminListLimit)
}

func (s *Store) find(ctx context.Context, filter bson.M, limit int64) ([]Claim, error) {
	cursor, err := s.claims.Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "lastMessageAt", Value: -1}}).
		SetLimit(limit).
		SetProjection(listProjection))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	rows := []Claim{}
	err = cursor.All(ctx, &rows)
	return rows, err
}

// Get loads one claim without its screenshot. With accountID set, it must be that account's.
func (s *Store) Get(ctx context.Context, id, accountID string) (Claim, error) {
	return s.get(ctx, id, accountID, listProjection)
}

// Screenshot loads one claim with its screenshot bytes.
func (s *Store) Screenshot(ctx context.Context, id string) (Claim, error) {
	return s.get(ctx, id, "", nil)
}

func (s *Store) get(ctx context.Context, id, accountID string, projection bson.M) (Claim, error) {
	if !s.ready() || id == "" {
		return Claim{}, mongo.ErrNoDocuments
	}
	filter := bson.M{"_id": id}
	if accountID != "" {
		filter["accountId"] = accountID
	}
	opts := options.FindOne()
	if projection != nil {
		opts.SetProjection(projection)
	}
	var row Claim
	err := s.claims.FindOne(ctx, filter, opts).Decode(&row)
	return row, err
}

// Messages is a claim's conversation, oldest first.
func (s *Store) Messages(ctx context.Context, claimID string) ([]Message, error) {
	if !s.ready() {
		return nil, nil
	}
	cursor, err := s.messages.Find(ctx, bson.M{"claimId": claimID}, options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: 1}}).
		SetLimit(threadLimit))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	rows := []Message{}
	err = cursor.All(ctx, &rows)
	return rows, err
}

// AddMessage appends to the claim's conversation and returns the message and the
// updated claim. The author has read everything up to their own message. A
// reporter's message reopens a closed claim.
func (s *Store) AddMessage(ctx context.Context, claim Claim, author, authorName, body string) (Message, Claim, error) {
	body = strings.TrimSpace(body)
	if !s.ready() || body == "" || len(body) > MaxMessageLen || (author != AuthorUser && author != AuthorAdmin) {
		return Message{}, Claim{}, ErrInvalidMessage
	}
	if author == AuthorUser {
		count, err := s.messages.CountDocuments(ctx, bson.M{
			"accountId": claim.AccountID, "author": AuthorUser,
			"createdAt": bson.M{"$gte": time.Now().UTC().Add(-claimRateLimitWindow)},
		})
		if err != nil {
			return Message{}, Claim{}, err
		}
		if count >= maxMessagesPerWindow {
			return Message{}, Claim{}, ErrRateLimited
		}
	}
	now := time.Now().UTC()
	msg := Message{
		ID: bson.NewObjectID().Hex(), ClaimID: claim.ID, AccountID: claim.AccountID,
		Author: author, AuthorName: strings.TrimSpace(authorName), Body: body, CreatedAt: now,
	}
	if _, err := s.messages.InsertOne(ctx, msg); err != nil {
		return Message{}, Claim{}, err
	}
	set := bson.M{"lastMessageAt": now, "lastMessageBy": author, readField(author): now}
	if author == AuthorUser {
		set["status"] = StatusOpen
	}
	var updated Claim
	err := s.claims.FindOneAndUpdate(ctx, bson.M{"_id": claim.ID},
		bson.M{"$set": set, "$inc": bson.M{"messageCount": 1}},
		options.FindOneAndUpdate().SetReturnDocument(options.After).SetProjection(listProjection),
	).Decode(&updated)
	return msg, updated, err
}

// MarkRead records that reader has seen the claim's conversation.
func (s *Store) MarkRead(ctx context.Context, claimID, reader string) error {
	if !s.ready() || (reader != AuthorUser && reader != AuthorAdmin) {
		return mongo.ErrNoDocuments
	}
	res, err := s.claims.UpdateOne(ctx, bson.M{"_id": claimID}, bson.M{"$set": bson.M{readField(reader): time.Now().UTC()}})
	if err == nil && res.MatchedCount == 0 {
		return mongo.ErrNoDocuments
	}
	return err
}

func readField(reader string) string {
	if reader == AuthorAdmin {
		return "adminReadAt"
	}
	return "userReadAt"
}

// SetStatus opens or closes a claim and returns it.
func (s *Store) SetStatus(ctx context.Context, id, status string) (Claim, error) {
	if !s.ready() || id == "" || (status != StatusOpen && status != StatusClosed) {
		return Claim{}, mongo.ErrNoDocuments
	}
	update := bson.M{"$set": bson.M{"status": status}}
	if status == StatusClosed {
		update["$set"].(bson.M)["closedAt"] = time.Now().UTC()
	} else {
		update["$unset"] = bson.M{"closedAt": ""}
	}
	var row Claim
	err := s.claims.FindOneAndUpdate(ctx, bson.M{"_id": id}, update,
		options.FindOneAndUpdate().SetReturnDocument(options.After).SetProjection(listProjection),
	).Decode(&row)
	return row, err
}

// Counts is how many claims are open and how many wait on support.
func (s *Store) Counts(ctx context.Context) (open, awaitingSupport int64, err error) {
	if !s.ready() {
		return 0, 0, nil
	}
	open, err = s.claims.CountDocuments(ctx, bson.M{"status": StatusOpen})
	if err != nil {
		return 0, 0, err
	}
	awaitingSupport, err = s.claims.CountDocuments(ctx, bson.M{"status": StatusOpen, "lastMessageBy": AuthorUser})
	return open, awaitingSupport, err
}
