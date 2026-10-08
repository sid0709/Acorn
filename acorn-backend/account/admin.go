package account

import (
	"context"
	"regexp"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	// MaxAdminPage is the most accounts one support-console page lists.
	MaxAdminPage = 100
	// maxAdminLookup bounds lookups by id list and by sign-up window.
	maxAdminLookup = 5000
)

var accountRowProjection = bson.M{"id": 1, "name": 1, "email": 1, "createdAt": 1, "deactivatedAt": 1}

func accountFrom(doc storedAccount) AccountRow {
	return AccountRow{
		ID: doc.ID, Name: doc.Name, Email: doc.Email,
		CreatedAt: doc.CreatedAt, DeactivatedAt: doc.DeactivatedAt,
	}
}

// SearchAccounts is one page of accounts whose name or email contains query
// (case-insensitive), newest first, and how many match in total.
func (s *Store) SearchAccounts(ctx context.Context, query string, page, pageSize int) ([]AccountRow, int64, error) {
	if s == nil || s.accounts == nil {
		return nil, 0, nil
	}
	if pageSize <= 0 || pageSize > MaxAdminPage {
		pageSize = MaxAdminPage
	}
	if page < 1 {
		page = 1
	}
	filter := bson.M{}
	if query = strings.TrimSpace(query); query != "" {
		pattern := bson.Regex{Pattern: regexp.QuoteMeta(query), Options: "i"}
		filter["$or"] = bson.A{bson.M{"name": pattern}, bson.M{"email": pattern}}
	}
	total, err := s.accounts.CountDocuments(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.findRows(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: -1}}).
		SetSkip(int64((page-1)*pageSize)).
		SetLimit(int64(pageSize)))
	return rows, total, err
}

// AccountsByID loads the named accounts; ids with no account are missing from the map.
func (s *Store) AccountsByID(ctx context.Context, ids []string) (map[string]AccountRow, error) {
	out := map[string]AccountRow{}
	if s == nil || s.accounts == nil || len(ids) == 0 {
		return out, nil
	}
	rows, err := s.findRows(ctx, bson.M{"id": bson.M{"$in": ids}}, options.Find().SetLimit(maxAdminLookup))
	for _, row := range rows {
		out[row.ID] = row
	}
	return out, err
}

// CreatedBetween is the ids of accounts that signed up in [from, to).
func (s *Store) CreatedBetween(ctx context.Context, from, to time.Time) ([]string, error) {
	if s == nil || s.accounts == nil {
		return nil, nil
	}
	rows, err := s.findRows(ctx, bson.M{"createdAt": bson.M{"$gte": from, "$lt": to}}, options.Find().SetLimit(maxAdminLookup))
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids, err
}

func (s *Store) findRows(ctx context.Context, filter bson.M, opts *options.FindOptionsBuilder) ([]AccountRow, error) {
	cursor, err := s.accounts.Find(ctx, filter, opts.SetProjection(accountRowProjection))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var docs []storedAccount
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	rows := make([]AccountRow, 0, len(docs))
	for _, doc := range docs {
		rows = append(rows, accountFrom(doc))
	}
	return rows, nil
}
