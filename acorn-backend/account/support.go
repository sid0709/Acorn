package account

import (
	"context"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// SupportSessionTTL is how long a session an admin opened as the user lasts.
// acorn-frontend keeps that session's cookie for the same span.
const SupportSessionTTL = 2 * time.Hour

// IssueSupportSession signs an admin in as the user for SupportSessionTTL and
// returns the token and when it expires. The session is marked with the admin,
// so the API, the site and the extension can show it and usage can tell it apart.
func (s *Store) IssueSupportSession(ctx context.Context, userID, adminEmail, reason string, now time.Time) (string, time.Time, error) {
	userID = strings.TrimSpace(userID)
	adminEmail = strings.TrimSpace(adminEmail)
	if userID == "" || adminEmail == "" {
		return "", time.Time{}, ErrInvalid
	}
	row, err := s.GetAccount(ctx, userID)
	if err != nil {
		return "", time.Time{}, err
	}
	if row.Deactivated() {
		return "", time.Time{}, ErrDeactivated
	}
	expires := now.Add(SupportSessionTTL).UTC()
	token, err := s.storeSession(ctx, storedSession{
		UserID:        userID,
		ExpiresAt:     expires,
		CreatedAt:     now.UTC(),
		SupportBy:     adminEmail,
		SupportReason: strings.TrimSpace(reason),
	})
	return token, expires, err
}

// RevokeSupportSessions ends every admin-opened session for the user and says how many ended.
// The user's own sessions stay.
func (s *Store) RevokeSupportSessions(ctx context.Context, userID string) (int64, error) {
	s.checked.forgetUser(userID)
	res, err := s.sessions.DeleteMany(ctx, bson.M{"userId": userID, "supportBy": bson.M{"$gt": ""}})
	if err != nil {
		return 0, err
	}
	return res.DeletedCount, nil
}
