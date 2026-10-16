// Package mailbox stores Gmail OAuth grants and reads and labels inbox mail for Acorn.
package mailbox

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	mailboxesCollection   = "acorn_gmail_mailboxes"
	oauthStatesCollection = "acorn_gmail_oauth_states"
	guidesCollection      = "acorn_gmail_label_guides"
	oauthStateTTL         = 10 * time.Minute
	maxEmailLength        = 254
	maxLabelLength        = 40
)

var (
	ErrNotConfigured = errors.New("Gmail is not set up")
	ErrInvalid       = errors.New("check the email and label")
	ErrOAuthState    = errors.New("the Gmail connection expired; try again")
	ErrNotFound      = errors.New("mailbox not found")
	ErrEmailMismatch = errors.New("Google signed in with a different Gmail than you entered")
	ErrDuplicate     = errors.New("that Gmail is already connected")
)

// Mailbox is one connected Gmail account for an Acorn user.
type Mailbox struct {
	ID    string
	Email string
	// Name and Picture are the Google account's, saved when it connected.
	Name                string
	Picture             string
	Label               string
	IsDefault           bool
	WatchesApplications bool
	// CanModify is true when the grant includes permission to apply labels.
	CanModify   bool
	ConnectedAt time.Time
}

type storedMailbox struct {
	ID                  string    `bson:"id"`
	UserID              string    `bson:"userId"`
	Email               string    `bson:"email"`
	Name                string    `bson:"name,omitempty"`
	Picture             string    `bson:"picture,omitempty"`
	GoogleSubject       string    `bson:"googleSubject"`
	Label               string    `bson:"label"`
	IsDefault           bool      `bson:"isDefault"`
	WatchesApplications bool      `bson:"watchesApplications"`
	CanModify           bool      `bson:"canModify"`
	RefreshToken        string    `bson:"refreshToken"`
	ConnectedAt         time.Time `bson:"connectedAt"`
}

type storedOAuthState struct {
	State       string    `bson:"state"`
	UserID      string    `bson:"userId"`
	Verifier    string    `bson:"verifier"`
	Redirect    string    `bson:"redirect"`
	Label       string    `bson:"label"`
	LoginHint   string    `bson:"loginHint"`
	Reauthorize bool      `bson:"reauthorize,omitempty"`
	ExpiresAt   time.Time `bson:"expiresAt"`
}

// Provider exchanges OAuth codes and reads Gmail.
type Provider interface {
	Configured() bool
	AuthURL(state, loginHint, codeChallenge string) string
	Exchange(ctx context.Context, code, redirect, verifier string) (GoogleGrant, error)
}

type GoogleGrant struct {
	Subject      string
	Email        string
	Name         string
	Picture      string
	RefreshToken string
	CanModify    bool
}

// Grant is the stored token for one mailbox and whether it can apply labels.
type Grant struct {
	RefreshToken string
	CanModify    bool
}

// Store keeps Gmail connections per Acorn account.
type Store struct {
	mailboxes   *mongo.Collection
	oauthStates *mongo.Collection
	guides      *mongo.Collection
	provider    Provider
}

func NewStore(client *mongo.Client, database string, provider Provider) *Store {
	db := client.Database(database)
	return &Store{
		mailboxes:   db.Collection(mailboxesCollection),
		oauthStates: db.Collection(oauthStatesCollection),
		guides:      db.Collection(guidesCollection),
		provider:    provider,
	}
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	_, err := s.mailboxes.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "email", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "id", Value: 1}}, Options: options.Index().SetUnique(true)},
	})
	if err != nil {
		return err
	}
	_, err = s.oauthStates.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "state", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		return err
	}
	_, err = s.guides.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "accountId", Value: 1},
			{Key: "mailboxId", Value: 1},
			{Key: "labelId", Value: 1},
		},
		Options: options.Index().SetUnique(true),
	})
	return err
}

func (s *Store) Ready() bool {
	return s != nil && s.provider != nil && s.provider.Configured()
}

func (s *Store) List(ctx context.Context, userID string) ([]Mailbox, error) {
	cursor, err := s.mailboxes.Find(ctx, bson.D{{Key: "userId", Value: userID}})
	if err != nil {
		return nil, err
	}
	var docs []storedMailbox
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]Mailbox, len(docs))
	for i, doc := range docs {
		out[i] = mailboxFromStored(doc)
	}
	return out, nil
}

func (s *Store) StartConnect(ctx context.Context, userID, email, label, redirect, verifier, challenge, state string, now time.Time, reauthorize bool) (string, error) {
	if !s.Ready() {
		return "", ErrNotConfigured
	}
	email = normalizeEmail(email)
	label = strings.TrimSpace(label)
	if email == "" || len(email) > maxEmailLength || !strings.Contains(email, "@") {
		return "", ErrInvalid
	}
	if len(label) > maxLabelLength {
		return "", ErrInvalid
	}
	if state == "" || verifier == "" || redirect == "" {
		return "", ErrInvalid
	}
	count, err := s.mailboxes.CountDocuments(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "email", Value: email}})
	if err != nil {
		return "", err
	}
	if reauthorize {
		if count == 0 {
			return "", ErrNotFound
		}
	} else if count > 0 {
		return "", ErrDuplicate
	}
	_, err = s.oauthStates.InsertOne(ctx, storedOAuthState{
		State:       state,
		UserID:      userID,
		Verifier:    verifier,
		Redirect:    redirect,
		Label:       label,
		LoginHint:   email,
		Reauthorize: reauthorize,
		ExpiresAt:   now.UTC().Add(oauthStateTTL),
	})
	if err != nil {
		return "", err
	}
	return s.provider.AuthURL(state, email, challenge), nil
}

func (s *Store) FinishConnect(ctx context.Context, userID, state, code string, now time.Time) (Mailbox, error) {
	if !s.Ready() {
		return Mailbox{}, ErrNotConfigured
	}
	record, err := s.takeOAuthState(ctx, state, now)
	if err != nil {
		return Mailbox{}, err
	}
	if record.UserID != userID {
		return Mailbox{}, ErrOAuthState
	}
	grant, err := s.provider.Exchange(ctx, code, record.Redirect, record.Verifier)
	if err != nil {
		return Mailbox{}, err
	}
	grant.Email = normalizeEmail(grant.Email)
	if grant.Email == "" || grant.RefreshToken == "" || grant.Subject == "" {
		return Mailbox{}, ErrInvalid
	}
	if record.LoginHint != "" && grant.Email != record.LoginHint {
		return Mailbox{}, ErrEmailMismatch
	}
	if record.Reauthorize {
		return s.replaceGrant(ctx, userID, grant)
	}
	count, err := s.mailboxes.CountDocuments(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "email", Value: grant.Email}})
	if err != nil {
		return Mailbox{}, err
	}
	if count > 0 {
		return Mailbox{}, ErrDuplicate
	}
	id, err := newID()
	if err != nil {
		return Mailbox{}, err
	}
	label := strings.TrimSpace(record.Label)
	if label == "" {
		label = "Gmail"
	}
	hasDefault, err := s.mailboxes.CountDocuments(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "isDefault", Value: true}})
	if err != nil {
		return Mailbox{}, err
	}
	doc := storedMailbox{
		ID:                  id,
		UserID:              userID,
		Email:               grant.Email,
		Name:                grant.Name,
		Picture:             grant.Picture,
		GoogleSubject:       grant.Subject,
		Label:               label,
		IsDefault:           hasDefault == 0,
		WatchesApplications: true,
		CanModify:           grant.CanModify,
		RefreshToken:        grant.RefreshToken,
		ConnectedAt:         now.UTC(),
	}
	if _, err := s.mailboxes.InsertOne(ctx, doc); err != nil {
		return Mailbox{}, err
	}
	return mailboxFromStored(doc), nil
}

func (s *Store) Disconnect(ctx context.Context, userID, mailboxID string) error {
	if _, err := s.guides.DeleteMany(ctx, bson.D{{Key: "accountId", Value: userID}, {Key: "mailboxId", Value: mailboxID}}); err != nil {
		return err
	}
	res, err := s.mailboxes.DeleteOne(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "id", Value: mailboxID}})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return ErrNotFound
	}
	remaining, err := s.List(ctx, userID)
	if err != nil {
		return err
	}
	if len(remaining) > 0 && !anyDefault(remaining) {
		_, err = s.mailboxes.UpdateOne(ctx,
			bson.D{{Key: "userId", Value: userID}, {Key: "id", Value: remaining[0].ID}},
			bson.D{{Key: "$set", Value: bson.D{{Key: "isDefault", Value: true}}}},
		)
	}
	return err
}

func (s *Store) Patch(ctx context.Context, userID, mailboxID string, isDefault *bool, watches *bool) (Mailbox, error) {
	filter := bson.D{{Key: "userId", Value: userID}, {Key: "id", Value: mailboxID}}
	var doc storedMailbox
	if err := s.mailboxes.FindOne(ctx, filter).Decode(&doc); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return Mailbox{}, ErrNotFound
		}
		return Mailbox{}, err
	}
	updates := bson.D{}
	if isDefault != nil && *isDefault {
		_, _ = s.mailboxes.UpdateMany(ctx, bson.D{{Key: "userId", Value: userID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "isDefault", Value: false}}}})
		updates = append(updates, bson.E{Key: "isDefault", Value: true})
	}
	if watches != nil {
		updates = append(updates, bson.E{Key: "watchesApplications", Value: *watches})
	}
	if len(updates) == 0 {
		return mailboxFromStored(doc), nil
	}
	if err := s.mailboxes.FindOneAndUpdate(ctx, filter, bson.D{{Key: "$set", Value: updates}}).Decode(&doc); err != nil {
		return Mailbox{}, err
	}
	return mailboxFromStored(doc), nil
}

func (s *Store) RefreshToken(ctx context.Context, userID, mailboxID string) (string, error) {
	grant, err := s.Grant(ctx, userID, mailboxID)
	if err != nil {
		return "", err
	}
	return grant.RefreshToken, nil
}

func (s *Store) Grant(ctx context.Context, userID, mailboxID string) (Grant, error) {
	var doc storedMailbox
	err := s.mailboxes.FindOne(ctx, bson.D{{Key: "userId", Value: userID}, {Key: "id", Value: mailboxID}}).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Grant{}, ErrNotFound
	}
	if err != nil {
		return Grant{}, err
	}
	return Grant{RefreshToken: doc.RefreshToken, CanModify: doc.CanModify}, nil
}

func (s *Store) replaceGrant(ctx context.Context, userID string, grant GoogleGrant) (Mailbox, error) {
	var doc storedMailbox
	err := s.mailboxes.FindOneAndUpdate(ctx,
		bson.D{{Key: "userId", Value: userID}, {Key: "email", Value: grant.Email}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "refreshToken", Value: grant.RefreshToken},
			{Key: "name", Value: grant.Name},
			{Key: "picture", Value: grant.Picture},
			{Key: "googleSubject", Value: grant.Subject},
			{Key: "canModify", Value: grant.CanModify},
		}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Mailbox{}, ErrNotFound
	}
	if err != nil {
		return Mailbox{}, err
	}
	return mailboxFromStored(doc), nil
}

func (s *Store) takeOAuthState(ctx context.Context, state string, now time.Time) (storedOAuthState, error) {
	if state == "" {
		return storedOAuthState{}, ErrOAuthState
	}
	var record storedOAuthState
	err := s.oauthStates.FindOneAndDelete(ctx, bson.D{{Key: "state", Value: state}}).Decode(&record)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return storedOAuthState{}, ErrOAuthState
	}
	if err != nil {
		return storedOAuthState{}, err
	}
	if !record.ExpiresAt.After(now) || record.Verifier == "" {
		return storedOAuthState{}, ErrOAuthState
	}
	return record, nil
}

func mailboxFromStored(doc storedMailbox) Mailbox {
	return Mailbox{
		ID:                  doc.ID,
		Email:               doc.Email,
		Name:                doc.Name,
		Picture:             doc.Picture,
		Label:               doc.Label,
		IsDefault:           doc.IsDefault,
		WatchesApplications: doc.WatchesApplications,
		CanModify:           doc.CanModify,
		ConnectedAt:         doc.ConnectedAt,
	}
}

func anyDefault(boxes []Mailbox) bool {
	for _, box := range boxes {
		if box.IsDefault {
			return true
		}
	}
	return false
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func newID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
