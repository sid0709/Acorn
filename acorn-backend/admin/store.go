// Package admin is the support console's accounts and sessions.
package admin

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	usersCollection    = "acorn_admin_users"
	sessionsCollection = "acorn_admin_sessions"
	sessionTTL         = 7 * 24 * time.Hour

	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	saltBytes    = 16
	tokenBytes   = 32
)

var ErrInvalidLogin = errors.New("email or password is incorrect")

// Config bootstraps the first admin and signs session tokens.
type Config struct {
	SessionSecret     string
	BootstrapEmail    string
	BootstrapPassword string
}

type storedAdmin struct {
	Email        string    `bson:"email"`
	PasswordHash []byte    `bson:"passwordHash"`
	PasswordSalt []byte    `bson:"passwordSalt"`
	CreatedAt    time.Time `bson:"createdAt"`
}

type storedSession struct {
	TokenHash string    `bson:"tokenHash"`
	Email     string    `bson:"email"`
	ExpiresAt time.Time `bson:"expiresAt"`
	CreatedAt time.Time `bson:"createdAt"`
}

// Store keeps admin users and sessions.
type Store struct {
	users    *mongo.Collection
	sessions *mongo.Collection
	cfg      Config
}

func NewStore(client *mongo.Client, database string, cfg Config) *Store {
	store := &Store{cfg: cfg}
	if client != nil && database != "" {
		db := client.Database(database)
		store.users = db.Collection(usersCollection)
		store.sessions = db.Collection(sessionsCollection)
	}
	return store
}

func (s *Store) Ready() bool {
	return s != nil && s.users != nil && strings.TrimSpace(s.cfg.SessionSecret) != ""
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	if s == nil || s.users == nil {
		return nil
	}
	if _, err := s.users.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "email", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}
	if _, err := s.sessions.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "tokenHash", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}
	_, err := s.sessions.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "expiresAt", Value: 1}},
		Options: options.Index().SetExpireAfterSeconds(0),
	})
	return err
}

func (s *Store) EnsureBootstrap(ctx context.Context) error {
	if s == nil || s.users == nil {
		return nil
	}
	email := normalizeEmail(s.cfg.BootstrapEmail)
	password := s.cfg.BootstrapPassword
	if email == "" || password == "" {
		return nil
	}
	count, err := s.users.CountDocuments(ctx, bson.M{})
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, salt, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.users.InsertOne(ctx, storedAdmin{
		Email: email, PasswordHash: hash, PasswordSalt: salt, CreatedAt: time.Now().UTC(),
	})
	return err
}

// SignIn checks credentials and opens a session token.
func (s *Store) SignIn(ctx context.Context, email, password string, now time.Time) (string, error) {
	if !s.Ready() {
		return "", errors.New("admin sign-in is not configured")
	}
	if err := s.EnsureBootstrap(ctx); err != nil {
		return "", err
	}
	email = normalizeEmail(email)
	var doc storedAdmin
	err := s.users.FindOne(ctx, bson.M{"email": email}).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", ErrInvalidLogin
	}
	if err != nil {
		return "", err
	}
	if !passwordMatches(password, doc.PasswordHash, doc.PasswordSalt) {
		return "", ErrInvalidLogin
	}
	token, err := newToken()
	if err != nil {
		return "", err
	}
	_, err = s.sessions.InsertOne(ctx, storedSession{
		TokenHash: hashToken(token, s.cfg.SessionSecret),
		Email:     email,
		ExpiresAt: now.UTC().Add(sessionTTL),
		CreatedAt: now.UTC(),
	})
	if err != nil {
		return "", err
	}
	return token, nil
}

// Session resolves a bearer token or admin session cookie.
func (s *Store) Session(ctx context.Context, token string, now time.Time) (string, error) {
	if !s.Ready() || token == "" {
		return "", ErrInvalidLogin
	}
	var doc storedSession
	err := s.sessions.FindOne(ctx, bson.M{
		"tokenHash": hashToken(token, s.cfg.SessionSecret),
		"expiresAt": bson.M{"$gt": now.UTC()},
	}).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", ErrInvalidLogin
	}
	if err != nil {
		return "", err
	}
	return doc.Email, nil
}

// Revoke ends one session.
func (s *Store) Revoke(ctx context.Context, token string) error {
	if !s.Ready() || token == "" {
		return nil
	}
	_, err := s.sessions.DeleteOne(ctx, bson.M{"tokenHash": hashToken(token, s.cfg.SessionSecret)})
	return err
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func hashPassword(password string) (hash, salt []byte, err error) {
	salt = make([]byte, saltBytes)
	if _, err = rand.Read(salt); err != nil {
		return nil, nil, err
	}
	hash = argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return hash, salt, nil
}

func passwordMatches(password string, hash, salt []byte) bool {
	if len(hash) == 0 || len(salt) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return subtle.ConstantTimeCompare(got, hash) == 1
}

func newToken() (string, error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func hashToken(token, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}
