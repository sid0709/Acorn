// Package supportaccess lets an admin open a user's account for support: single-use
// handoff codes that carry the admin's sign-in to the site and the extension, and
// the audit trail of every support session.
package supportaccess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	handoffsCollection = "acorn_support_handoffs"
	auditCollection    = "acorn_admin_audit"

	// HandoffTTL is how long a handoff code works. The admin's new tab and the
	// site's message to the extension both use it within seconds.
	HandoffTTL = 2 * time.Minute
	codeBytes  = 32

	// MaxReasonLength bounds the reason an admin gives for a support session.
	MaxReasonLength = 500
	auditListLimit  = 50
)

// Purposes say which client a handoff code signs in.
const (
	PurposeWeb       = "web"
	PurposeExtension = "extension"
)

// Audit actions.
const (
	ActionSupportStart     = "support_session_start"
	ActionSupportExtension = "support_session_extension"
	ActionSupportRevoke    = "support_sessions_revoked"
)

// ErrInvalidCode is a code that is unknown, used, or expired.
var ErrInvalidCode = errors.New("this support link has expired or was already used")

// Handoff is one code's grant: sign in as UserID on behalf of AdminEmail.
type Handoff struct {
	CodeHash   string     `bson:"codeHash"`
	UserID     string     `bson:"userId"`
	AdminEmail string     `bson:"adminEmail"`
	Reason     string     `bson:"reason"`
	Purpose    string     `bson:"purpose"`
	ExpiresAt  time.Time  `bson:"expiresAt"`
	CreatedAt  time.Time  `bson:"createdAt"`
	UsedAt     *time.Time `bson:"usedAt"`
}

// AuditEntry is one admin action on a user's account.
type AuditEntry struct {
	ID     string    `bson:"_id" json:"id"`
	Admin  string    `bson:"admin" json:"admin"`
	Action string    `bson:"action" json:"action"`
	UserID string    `bson:"userId" json:"userId"`
	Reason string    `bson:"reason" json:"reason"`
	At     time.Time `bson:"at" json:"at"`
}

type Store struct {
	handoffs *mongo.Collection
	audit    *mongo.Collection
}

func NewStore(client *mongo.Client, database string) *Store {
	db := client.Database(database)
	return &Store{handoffs: db.Collection(handoffsCollection), audit: db.Collection(auditCollection)}
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	models := map[*mongo.Collection][]mongo.IndexModel{
		s.handoffs: {
			{Keys: bson.D{{Key: "codeHash", Value: 1}}, Options: options.Index().SetUnique(true)},
			{Keys: bson.D{{Key: "expiresAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)},
		},
		s.audit: {
			{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "at", Value: -1}}},
		},
	}
	for coll, indexes := range models {
		if _, err := coll.Indexes().CreateMany(ctx, indexes); err != nil {
			return err
		}
	}
	return nil
}

// CreateHandoff stores a single-use code for this grant and returns the code.
func (s *Store) CreateHandoff(ctx context.Context, grant Handoff, now time.Time) (string, error) {
	buf := make([]byte, codeBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	code := hex.EncodeToString(buf)
	grant.CodeHash = hashCode(code)
	grant.CreatedAt = now.UTC()
	grant.ExpiresAt = now.Add(HandoffTTL).UTC()
	grant.UsedAt = nil
	if _, err := s.handoffs.InsertOne(ctx, grant); err != nil {
		return "", err
	}
	return code, nil
}

// Redeem uses up a live code and returns its grant. A second redeem of the same code fails.
func (s *Store) Redeem(ctx context.Context, code string, now time.Time) (Handoff, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return Handoff{}, ErrInvalidCode
	}
	var grant Handoff
	err := s.handoffs.FindOneAndUpdate(ctx,
		bson.M{"codeHash": hashCode(code), "usedAt": nil, "expiresAt": bson.M{"$gt": now.UTC()}},
		bson.M{"$set": bson.M{"usedAt": now.UTC()}},
	).Decode(&grant)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Handoff{}, ErrInvalidCode
	}
	return grant, err
}

// Record adds one entry to the audit trail.
func (s *Store) Record(ctx context.Context, entry AuditEntry) error {
	if entry.ID == "" {
		entry.ID = bson.NewObjectID().Hex()
	}
	if entry.At.IsZero() {
		entry.At = time.Now().UTC()
	}
	_, err := s.audit.InsertOne(ctx, entry)
	return err
}

// AuditFor is the newest admin actions on one user's account.
func (s *Store) AuditFor(ctx context.Context, userID string) ([]AuditEntry, error) {
	cursor, err := s.audit.Find(ctx, bson.M{"userId": userID}, options.Find().
		SetSort(bson.D{{Key: "at", Value: -1}}).
		SetLimit(auditListLimit))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	entries := []AuditEntry{}
	err = cursor.All(ctx, &entries)
	return entries, err
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}
