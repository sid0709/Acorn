package aiusage

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// AccountUsage is one account's recent totals for the admin user list.
type AccountUsage struct {
	Calls       int64      `json:"calls"`
	OK          int64      `json:"ok"`
	Cancelled   int64      `json:"cancelled"`
	SuccessRate float64    `json:"successRate"`
	CostNanos   int64      `json:"costNanos"`
	TotalTokens int64      `json:"totalTokens"`
	LastCallAt  *time.Time `json:"lastCallAt"`
}

// UsageByAccount totals each account's own calls since `since`, and the time of
// its latest call ever. Support-session calls are not the user's and are left out.
func (s *Store) UsageByAccount(ctx context.Context, accountIDs []string, since time.Time) (map[string]AccountUsage, error) {
	out := make(map[string]AccountUsage, len(accountIDs))
	if s == nil || s.coll == nil || len(accountIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		ID         string    `bson:"_id"`
		Calls      int64     `bson:"calls"`
		OK         int64     `bson:"ok"`
		Cancelled  int64     `bson:"cancelled"`
		CostNanos  int64     `bson:"costNanos"`
		Tokens     int64     `bson:"totalTokens"`
		LastCallAt time.Time `bson:"lastCallAt"`
	}
	recent := bson.M{"$gte": bson.A{field("createdAt"), since}}
	sumRecent := func(value any) bson.M {
		return bson.M{"$sum": bson.M{"$cond": bson.A{recent, value, 0}}}
	}
	recentAnd := func(cond bson.M) bson.M {
		return bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$and": bson.A{recent, cond}}, 1, 0}}}
	}
	if err := s.aggregate(ctx, &rows, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"accountId": bson.M{"$in": accountIDs}, "supportBy": ""}}},
		{{Key: "$group", Value: bson.M{
			"_id":         field("accountId"),
			"calls":       sumRecent(1),
			"ok":          recentAnd(eq("status", StatusOK)),
			"cancelled":   recentAnd(eq("status", StatusCancelled)),
			"costNanos":   sumRecent(field("costNanos")),
			"totalTokens": sumRecent(field("totalTokens")),
			"lastCallAt":  bson.M{"$max": field("createdAt")},
		}}},
	}); err != nil {
		return nil, err
	}
	for _, row := range rows {
		last := row.LastCallAt
		out[row.ID] = AccountUsage{
			Calls: row.Calls, OK: row.OK, Cancelled: row.Cancelled,
			SuccessRate: ratio(row.OK, row.Calls-row.Cancelled),
			CostNanos:   row.CostNanos, TotalTokens: row.Tokens, LastCallAt: &last,
		}
	}
	return out, nil
}

// ListByAccount is one page of an account's calls across tabs, newest first, and the total count.
func (s *Store) ListByAccount(ctx context.Context, accountID string, page, pageSize int) ([]Entry, int64, error) {
	if s == nil || s.coll == nil || accountID == "" {
		return nil, 0, nil
	}
	if pageSize <= 0 || pageSize > adminListLimit {
		pageSize = adminListLimit
	}
	if page < 1 {
		page = 1
	}
	filter := bson.M{"accountId": accountID}
	total, err := s.coll.CountDocuments(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	cursor, err := s.coll.Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: -1}}).
		SetSkip(int64((page-1)*pageSize)).
		SetLimit(int64(pageSize)))
	if err != nil {
		return nil, 0, err
	}
	defer cursor.Close(ctx)
	var entries []Entry
	if err := cursor.All(ctx, &entries); err != nil {
		return nil, 0, err
	}
	return entries, total, nil
}

// ActiveAmong counts how many of these accounts made at least one call of their own.
func (s *Store) ActiveAmong(ctx context.Context, accountIDs []string) (int64, error) {
	if s == nil || s.coll == nil || len(accountIDs) == 0 {
		return 0, nil
	}
	ids, err := s.coll.Distinct(ctx, "accountId", bson.M{"accountId": bson.M{"$in": accountIDs}, "supportBy": ""}).Raw()
	if err != nil {
		return 0, err
	}
	values, err := ids.Values()
	if err != nil {
		return 0, err
	}
	return int64(len(values)), nil
}
