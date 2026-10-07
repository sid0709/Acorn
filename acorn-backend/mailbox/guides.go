package mailbox

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	// MaxGuideDescription is the longest description stored for one label.
	MaxGuideDescription = 400
	maxGuides           = 100
	maxGuideLabelID     = 256
)

// ErrGuide is a label description the store will not keep.
var ErrGuide = errors.New("check the label descriptions")

// LabelGuide is the description Acorn uses to decide when a Gmail label applies.
type LabelGuide struct {
	LabelID     string
	Description string
}

type storedGuide struct {
	AccountID   string    `bson:"accountId"`
	MailboxID   string    `bson:"mailboxId"`
	LabelID     string    `bson:"labelId"`
	Description string    `bson:"description"`
	UpdatedAt   time.Time `bson:"updatedAt"`
}

// ListGuides returns the descriptions saved for this mailbox. Missing descriptions are omitted.
func (s *Store) ListGuides(ctx context.Context, accountID, mailboxID string) ([]LabelGuide, error) {
	cursor, err := s.guides.Find(ctx, bson.D{{Key: "accountId", Value: accountID}, {Key: "mailboxId", Value: mailboxID}})
	if err != nil {
		return nil, err
	}
	var docs []storedGuide
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]LabelGuide, len(docs))
	for i, doc := range docs {
		out[i] = LabelGuide{LabelID: doc.LabelID, Description: doc.Description}
	}
	return out, nil
}

// SaveGuides replaces this mailbox's descriptions. An empty description removes that label.
func (s *Store) SaveGuides(ctx context.Context, accountID, mailboxID string, guides []LabelGuide) error {
	if len(guides) > maxGuides {
		return ErrGuide
	}
	now := time.Now().UTC()
	kept := make([]string, 0, len(guides))
	writes := make([]mongo.WriteModel, 0, len(guides))
	seen := map[string]bool{}
	for _, guide := range guides {
		labelID := strings.TrimSpace(guide.LabelID)
		description := strings.TrimSpace(guide.Description)
		if labelID == "" && description == "" {
			continue
		}
		if labelID == "" || len(labelID) > maxGuideLabelID || utf8.RuneCountInString(description) > MaxGuideDescription {
			return ErrGuide
		}
		if seen[labelID] {
			return ErrGuide
		}
		seen[labelID] = true
		if description == "" {
			continue
		}
		kept = append(kept, labelID)
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.D{
				{Key: "accountId", Value: accountID},
				{Key: "mailboxId", Value: mailboxID},
				{Key: "labelId", Value: labelID},
			}).
			SetUpdate(bson.D{{Key: "$set", Value: storedGuide{
				AccountID:   accountID,
				MailboxID:   mailboxID,
				LabelID:     labelID,
				Description: description,
				UpdatedAt:   now,
			}}}).
			SetUpsert(true))
	}
	if len(writes) > 0 {
		if _, err := s.guides.BulkWrite(ctx, writes); err != nil {
			return err
		}
	}
	filter := bson.D{{Key: "accountId", Value: accountID}, {Key: "mailboxId", Value: mailboxID}}
	if len(kept) > 0 {
		filter = append(filter, bson.E{Key: "labelId", Value: bson.D{{Key: "$nin", Value: kept}}})
	}
	_, err := s.guides.DeleteMany(ctx, filter)
	return err
}
