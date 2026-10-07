package aiusage

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	// topUserLimit is how many accounts the "top users by cost" list shows.
	topUserLimit = 10
	// A tab that makes loopCallThreshold or more calls inside one loopBucketMinutes
	// bucket is probably stuck in a model-call loop.
	loopBucketMinutes = 10
	loopCallThreshold = 30
	hotTabLimit       = 20

	day   = 24 * time.Hour
	week  = 7 * day
	month = 30 * day
)

// Group is a Summary for one value of a breakdown (a model, a feature, an account…).
type Group struct {
	Key string `json:"key"`
	Summary
}

// Point is a Summary for one series bucket starting at Start.
type Point struct {
	Start time.Time `json:"start"`
	Summary
}

// HotTab is a tab that burst past the loop threshold.
type HotTab struct {
	AccountID  string    `json:"accountId"`
	TabKey     string    `json:"tabKey"`
	PeakCalls  int64     `json:"peakCalls"`
	Bursts     int64     `json:"bursts"`
	BurstCalls int64     `json:"burstCalls"`
	CostNanos  int64     `json:"costNanos"`
	First      time.Time `json:"first"`
	Last       time.Time `json:"last"`
}

// Engagement is distinct accounts with at least one call in the day, week and
// month up to the end of the period.
type Engagement struct {
	DAU        int64   `json:"dau"`
	WAU        int64   `json:"wau"`
	MAU        int64   `json:"mau"`
	Stickiness float64 `json:"stickiness"`
}

// LoopRule is what counts as a hot tab: Calls or more inside Minutes.
type LoopRule struct {
	Calls   int `json:"calls"`
	Minutes int `json:"minutes"`
}

// Statistics is everything the admin console charts for one filter.
type Statistics struct {
	Range       string     `json:"range"`
	Current     Window     `json:"current"`
	Previous    Window     `json:"previous"`
	Summary     Summary    `json:"summary"`
	PrevSummary Summary    `json:"previousSummary"`
	Engagement  Engagement `json:"engagement"`
	Series      []Point    `json:"series"`
	ByModel     []Group    `json:"byModel"`
	ByFeature   []Group    `json:"byFeature"`
	ByStep      []Group    `json:"byStep"`
	ByClient    []Group    `json:"byClient"`
	ByErrorKind []Group    `json:"byErrorKind"`
	TopUsers    []Group    `json:"topUsers"`
	HotTabs     []HotTab   `json:"hotTabs"`
	LoopRule    LoopRule   `json:"loopRule"`
	SLOs        []SLO      `json:"slos"`
}

// keyedRow and pointRow name their metrics field: the driver skips an
// unexported embedded struct, inline or not.
type keyedRow struct {
	ID      string   `bson:"_id"`
	Metrics groupRow `bson:",inline"`
}

type pointRow struct {
	ID      time.Time `bson:"_id"`
	Metrics groupRow  `bson:",inline"`
}

type hotTabRow struct {
	ID struct {
		AccountID string `bson:"a"`
		TabKey    string `bson:"t"`
	} `bson:"_id"`
	PeakCalls  int64     `bson:"peakCalls"`
	Bursts     int64     `bson:"bursts"`
	BurstCalls int64     `bson:"burstCalls"`
	CostNanos  int64     `bson:"costNanos"`
	First      time.Time `bson:"first"`
	Last       time.Time `bson:"last"`
}

type facetRow struct {
	Totals      []groupRow  `bson:"totals"`
	Series      []pointRow  `bson:"series"`
	ByModel     []keyedRow  `bson:"byModel"`
	ByFeature   []keyedRow  `bson:"byFeature"`
	ByStep      []keyedRow  `bson:"byStep"`
	ByClient    []keyedRow  `bson:"byClient"`
	ByErrorKind []keyedRow  `bson:"byErrorKind"`
	TopUsers    []keyedRow  `bson:"topUsers"`
	HotTabs     []hotTabRow `bson:"hotTabs"`
}

func breakdown(by string) bson.A {
	return bson.A{
		bson.D{{Key: "$group", Value: metricGroup(field(by))}},
		countUsers,
		bson.D{{Key: "$sort", Value: bson.D{{Key: "calls", Value: -1}}}},
	}
}

func seriesPipeline(bucket string) bson.A {
	return bson.A{
		bson.D{{Key: "$group", Value: metricGroup(bson.M{"$dateTrunc": bson.M{"date": field("createdAt"), "unit": bucket}})}},
		countUsers,
		bson.D{{Key: "$sort", Value: bson.D{{Key: "_id", Value: 1}}}},
	}
}

var hotTabsPipeline = bson.A{
	bson.D{{Key: "$match", Value: bson.M{"tabKey": bson.M{"$ne": ""}}}},
	bson.D{{Key: "$group", Value: bson.M{
		"_id": bson.M{
			"a": field("accountId"),
			"t": field("tabKey"),
			"b": bson.M{"$dateTrunc": bson.M{"date": field("createdAt"), "unit": "minute", "binSize": loopBucketMinutes}},
		},
		"calls": bson.M{"$sum": 1},
		"cost":  bson.M{"$sum": field("costNanos")},
		"first": bson.M{"$min": field("createdAt")},
		"last":  bson.M{"$max": field("createdAt")},
	}}},
	bson.D{{Key: "$match", Value: bson.M{"calls": bson.M{"$gte": loopCallThreshold}}}},
	bson.D{{Key: "$group", Value: bson.M{
		"_id":        bson.M{"a": "$_id.a", "t": "$_id.t"},
		"peakCalls":  bson.M{"$max": field("calls")},
		"bursts":     bson.M{"$sum": 1},
		"burstCalls": bson.M{"$sum": field("calls")},
		"costNanos":  bson.M{"$sum": field("cost")},
		"first":      bson.M{"$min": field("first")},
		"last":       bson.M{"$max": field("last")},
	}}},
	bson.D{{Key: "$sort", Value: bson.D{{Key: "peakCalls", Value: -1}}}},
	bson.D{{Key: "$limit", Value: hotTabLimit}},
}

// Statistics reads one filter's period, the period before it, and engagement.
func (s *Store) Statistics(ctx context.Context, filter Filter, now time.Time) (Statistics, error) {
	current, previous := filter.windows(now)
	stats := Statistics{
		Range: filter.rangeKey(), Current: current, Previous: previous,
		LoopRule: LoopRule{Calls: loopCallThreshold, Minutes: loopBucketMinutes},
	}
	if s == nil || s.coll == nil {
		stats.Series = fillSeries(current, nil)
		stats.SLOs = evaluateSLOs(stats.Summary)
		return stats, nil
	}

	totals := bson.A{bson.D{{Key: "$group", Value: metricGroup(nil)}}, countUsers}
	errorsOnly := append(bson.A{bson.D{{Key: "$match", Value: bson.M{"status": StatusError}}}}, breakdown("errorKind")...)
	topUsers := append(breakdown("accountId")[:2:2],
		bson.D{{Key: "$sort", Value: bson.D{{Key: "costNanos", Value: -1}, {Key: "calls", Value: -1}}}},
		bson.D{{Key: "$limit", Value: topUserLimit}})

	var rows []facetRow
	if err := s.aggregate(ctx, &rows, mongo.Pipeline{
		{{Key: "$match", Value: filter.match(current)}},
		{{Key: "$facet", Value: bson.M{
			"totals":      totals,
			"series":      seriesPipeline(current.Bucket),
			"byModel":     breakdown("model"),
			"byFeature":   breakdown("feature"),
			"byStep":      breakdown("step"),
			"byClient":    breakdown("client"),
			"byErrorKind": errorsOnly,
			"topUsers":    topUsers,
			"hotTabs":     hotTabsPipeline,
		}}},
	}); err != nil {
		return Statistics{}, err
	}
	if len(rows) > 0 {
		row := rows[0]
		if len(row.Totals) > 0 {
			stats.Summary = row.Totals[0].summary()
		}
		stats.Series = fillSeries(current, row.Series)
		stats.ByModel = groups(row.ByModel)
		stats.ByFeature = groups(row.ByFeature)
		stats.ByStep = groups(row.ByStep)
		stats.ByClient = groups(row.ByClient)
		stats.ByErrorKind = groups(row.ByErrorKind)
		stats.TopUsers = groups(row.TopUsers)
		stats.HotTabs = hotTabs(row.HotTabs)
	} else {
		stats.Series = fillSeries(current, nil)
	}

	var prev []groupRow
	if err := s.aggregate(ctx, &prev, append(mongo.Pipeline{{{Key: "$match", Value: filter.match(previous)}}}, totals[0].(bson.D), countUsers)); err != nil {
		return Statistics{}, err
	}
	if len(prev) > 0 {
		stats.PrevSummary = prev[0].summary()
	}

	engagement, err := s.engagement(ctx, filter, current.To)
	if err != nil {
		return Statistics{}, err
	}
	stats.Engagement = engagement
	stats.SLOs = evaluateSLOs(stats.Summary)
	return stats, nil
}

// engagement counts distinct accounts in the day, week and month before to,
// whatever the selected range.
func (s *Store) engagement(ctx context.Context, filter Filter, to time.Time) (Engagement, error) {
	match := filter.match(Window{From: to.Add(-month), To: to})
	distinct := func(since time.Duration) bson.A {
		return bson.A{
			bson.D{{Key: "$match", Value: bson.M{"createdAt": bson.M{"$gte": to.Add(-since)}}}},
			bson.D{{Key: "$group", Value: bson.M{"_id": field("accountId")}}},
			bson.D{{Key: "$count", Value: "n"}},
		}
	}
	var rows []struct {
		DAU []struct{ N int64 } `bson:"dau"`
		WAU []struct{ N int64 } `bson:"wau"`
		MAU []struct{ N int64 } `bson:"mau"`
	}
	if err := s.aggregate(ctx, &rows, mongo.Pipeline{
		{{Key: "$match", Value: match}},
		{{Key: "$facet", Value: bson.M{"dau": distinct(day), "wau": distinct(week), "mau": distinct(month)}}},
	}); err != nil {
		return Engagement{}, err
	}
	var e Engagement
	if len(rows) == 0 {
		return e, nil
	}
	first := func(v []struct{ N int64 }) int64 {
		if len(v) == 0 {
			return 0
		}
		return v[0].N
	}
	e.DAU, e.WAU, e.MAU = first(rows[0].DAU), first(rows[0].WAU), first(rows[0].MAU)
	e.Stickiness = ratio(e.DAU, e.MAU)
	return e, nil
}

func (s *Store) aggregate(ctx context.Context, out any, pipeline mongo.Pipeline) error {
	cursor, err := s.coll.Aggregate(ctx, pipeline)
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)
	return cursor.All(ctx, out)
}

// unknownKey labels calls with no value for a breakdown (an untagged route, no client header…).
const unknownKey = "unknown"

func groups(rows []keyedRow) []Group {
	out := make([]Group, 0, len(rows))
	for _, row := range rows {
		key := row.ID
		if key == "" {
			key = unknownKey
		}
		out = append(out, Group{Key: key, Summary: row.Metrics.summary()})
	}
	return out
}

func hotTabs(rows []hotTabRow) []HotTab {
	out := make([]HotTab, 0, len(rows))
	for _, row := range rows {
		out = append(out, HotTab{
			AccountID: row.ID.AccountID, TabKey: row.ID.TabKey,
			PeakCalls: row.PeakCalls, Bursts: row.Bursts, BurstCalls: row.BurstCalls,
			CostNanos: row.CostNanos, First: row.First, Last: row.Last,
		})
	}
	return out
}

// fillSeries returns one point per bucket in the window, zero where nothing ran,
// so charts have an even x axis.
func fillSeries(w Window, rows []pointRow) []Point {
	step := day
	if w.Bucket == bucketHour {
		step = time.Hour
	}
	byStart := make(map[time.Time]Summary, len(rows))
	for _, row := range rows {
		byStart[row.ID.UTC()] = row.Metrics.summary()
	}
	start := w.From.UTC().Truncate(step)
	out := make([]Point, 0, int(w.To.Sub(start)/step)+1)
	for t := start; t.Before(w.To); t = t.Add(step) {
		out = append(out, Point{Start: t, Summary: byStart[t]})
	}
	return out
}
