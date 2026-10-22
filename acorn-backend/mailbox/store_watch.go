package mailbox

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// Owned is a mailbox with the Acorn account that connected it.
type Owned struct {
	AccountID string
	Mailbox   Mailbox
}

// ByAddress is every mailbox connected for a Gmail address, across accounts: Gmail's push names the
// address, not the person.
func (s *Store) ByAddress(ctx context.Context, email string) ([]Owned, error) {
	return s.owned(ctx, bson.D{{Key: "email", Value: normalizeEmail(email)}})
}

// Modifiable is every mailbox whose grant can apply labels. Mail is only watched where a label can
// be applied.
func (s *Store) Modifiable(ctx context.Context) ([]Owned, error) {
	return s.owned(ctx, bson.D{{Key: "canModify", Value: true}})
}

func (s *Store) owned(ctx context.Context, filter bson.D) ([]Owned, error) {
	cursor, err := s.mailboxes.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	var docs []storedMailbox
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]Owned, len(docs))
	for i, doc := range docs {
		out[i] = Owned{AccountID: doc.UserID, Mailbox: mailboxFromStored(doc)}
	}
	return out, nil
}
