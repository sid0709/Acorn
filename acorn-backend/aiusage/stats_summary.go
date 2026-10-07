package aiusage

import (
	"math"

	"github.com/sid0709/OpenSeat/backend-core/openai"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// latencyPercentiles are the points every latency summary reports, in this order.
var latencyPercentiles = bson.A{0.5, 0.9, 0.95, 0.99}

// Summary is one set of call metrics: for a whole period, one series bucket, or one group.
// Rates are 0–1. Latency and throughput come from successful calls only, so a
// timeout does not read as a slow answer. Cancelled calls are not failures: success
// and error rates are out of the calls that were not cancelled.
type Summary struct {
	Calls       int64   `json:"calls"`
	OK          int64   `json:"ok"`
	Errors      int64   `json:"errors"`
	Cancelled   int64   `json:"cancelled"`
	SuccessRate float64 `json:"successRate"`
	ErrorRate   float64 `json:"errorRate"`
	CancelRate  float64 `json:"cancelRate"`
	ActiveUsers int64   `json:"activeUsers"`

	PromptTokens     int64   `json:"promptTokens"`
	CompletionTokens int64   `json:"completionTokens"`
	CachedTokens     int64   `json:"cachedTokens"`
	CacheWriteTokens int64   `json:"cacheWriteTokens"`
	TotalTokens      int64   `json:"totalTokens"`
	CacheHitRate     float64 `json:"cacheHitRate"`
	AvgTokensPerCall float64 `json:"avgTokensPerCall"`

	CostNanos            int64 `json:"costNanos"`
	CostPerCallNanos     int64 `json:"costPerCallNanos"`
	CostPerSuccessNanos  int64 `json:"costPerSuccessNanos"`
	CostPerUserNanos     int64 `json:"costPerUserNanos"`
	CostPer1kTokensNanos int64 `json:"costPer1kTokensNanos"`

	AvgMs           int64   `json:"avgMs"`
	P50Ms           int64   `json:"p50Ms"`
	P90Ms           int64   `json:"p90Ms"`
	P95Ms           int64   `json:"p95Ms"`
	P99Ms           int64   `json:"p99Ms"`
	TokensPerSecond float64 `json:"tokensPerSecond"`

	RetryRate      float64 `json:"retryRate"`
	TruncationRate float64 `json:"truncationRate"`
	EmptyRate      float64 `json:"emptyRate"`
}

func field(name string) string { return "$" + name }

func eq(name string, value any) bson.M { return bson.M{"$eq": bson.A{field(name), value}} }

func countIf(cond any) bson.M { return bson.M{"$sum": bson.M{"$cond": bson.A{cond, 1, 0}}} }

// whenOK is the field on successful calls and null otherwise; $avg and $percentile skip nulls.
func whenOK(name string) bson.M {
	return bson.M{"$cond": bson.A{eq("status", StatusOK), field(name), nil}}
}

func sumWhenOK(name string) bson.M {
	return bson.M{"$sum": bson.M{"$cond": bson.A{eq("status", StatusOK), field(name), 0}}}
}

// metricGroup is the $group body that every Summary is read from.
func metricGroup(id any) bson.M {
	return bson.M{
		"_id":                id,
		"calls":              bson.M{"$sum": 1},
		"ok":                 countIf(eq("status", StatusOK)),
		"errors":             countIf(eq("status", StatusError)),
		"cancelled":          countIf(eq("status", StatusCancelled)),
		"users":              bson.M{"$addToSet": field("accountId")},
		"promptTokens":       bson.M{"$sum": field("promptTokens")},
		"completionTokens":   bson.M{"$sum": field("completionTokens")},
		"cachedTokens":       bson.M{"$sum": field("cachedTokens")},
		"cacheWriteTokens":   bson.M{"$sum": field("cacheWriteTokens")},
		"totalTokens":        bson.M{"$sum": field("totalTokens")},
		"costNanos":          bson.M{"$sum": field("costNanos")},
		"avgMs":              bson.M{"$avg": whenOK("durationMs")},
		"pcts":               bson.M{"$percentile": bson.M{"input": whenOK("durationMs"), "p": latencyPercentiles, "method": "approximate"}},
		"okCompletionTokens": sumWhenOK("completionTokens"),
		"okDurationMs":       sumWhenOK("durationMs"),
		"retried":            countIf(bson.M{"$gt": bson.A{field("attempts"), 1}}),
		"truncated":          countIf(eq("finishReason", "length")),
		"empty":              countIf(eq("errorKind", openai.ErrorKindEmptyResponse)),
	}
}

// countUsers replaces the account set with its size after a metricGroup.
var countUsers = bson.D{{Key: "$set", Value: bson.M{"users": bson.M{"$size": field("users")}}}}

// groupRow is one metricGroup result.
type groupRow struct {
	Calls              int64      `bson:"calls"`
	OK                 int64      `bson:"ok"`
	Errors             int64      `bson:"errors"`
	Cancelled          int64      `bson:"cancelled"`
	Users              int64      `bson:"users"`
	PromptTokens       int64      `bson:"promptTokens"`
	CompletionTokens   int64      `bson:"completionTokens"`
	CachedTokens       int64      `bson:"cachedTokens"`
	CacheWriteTokens   int64      `bson:"cacheWriteTokens"`
	TotalTokens        int64      `bson:"totalTokens"`
	CostNanos          int64      `bson:"costNanos"`
	AvgMs              *float64   `bson:"avgMs"`
	Pcts               []*float64 `bson:"pcts"`
	OKCompletionTokens int64      `bson:"okCompletionTokens"`
	OKDurationMs       int64      `bson:"okDurationMs"`
	Retried            int64      `bson:"retried"`
	Truncated          int64      `bson:"truncated"`
	Empty              int64      `bson:"empty"`
}

func ratio(part, whole int64) float64 {
	if whole <= 0 {
		return 0
	}
	return float64(part) / float64(whole)
}

func perUnit(total, count int64) int64 {
	if count <= 0 {
		return 0
	}
	return int64(math.Round(float64(total) / float64(count)))
}

func roundMs(v *float64) int64 {
	if v == nil || math.IsNaN(*v) {
		return 0
	}
	return int64(math.Round(*v))
}

func (r groupRow) percentile(i int) int64 {
	if i >= len(r.Pcts) {
		return 0
	}
	return roundMs(r.Pcts[i])
}

func (r groupRow) summary() Summary {
	settled := r.Calls - r.Cancelled
	s := Summary{
		Calls:       r.Calls,
		OK:          r.OK,
		Errors:      r.Errors,
		Cancelled:   r.Cancelled,
		SuccessRate: ratio(r.OK, settled),
		ErrorRate:   ratio(r.Errors, settled),
		CancelRate:  ratio(r.Cancelled, r.Calls),
		ActiveUsers: r.Users,

		PromptTokens:     r.PromptTokens,
		CompletionTokens: r.CompletionTokens,
		CachedTokens:     r.CachedTokens,
		CacheWriteTokens: r.CacheWriteTokens,
		TotalTokens:      r.TotalTokens,
		CacheHitRate:     ratio(r.CachedTokens, r.PromptTokens),
		AvgTokensPerCall: ratio(r.TotalTokens, r.Calls),

		CostNanos:           r.CostNanos,
		CostPerCallNanos:    perUnit(r.CostNanos, r.Calls),
		CostPerSuccessNanos: perUnit(r.CostNanos, r.OK),
		CostPerUserNanos:    perUnit(r.CostNanos, r.Users),

		AvgMs: roundMs(r.AvgMs),
		P50Ms: r.percentile(0),
		P90Ms: r.percentile(1),
		P95Ms: r.percentile(2),
		P99Ms: r.percentile(3),

		RetryRate:      ratio(r.Retried, r.Calls),
		TruncationRate: ratio(r.Truncated, r.OK),
		EmptyRate:      ratio(r.Empty, r.Calls),
	}
	if r.TotalTokens > 0 {
		s.CostPer1kTokensNanos = int64(math.Round(float64(r.CostNanos) * 1000 / float64(r.TotalTokens)))
	}
	if r.OKDurationMs > 0 {
		s.TokensPerSecond = float64(r.OKCompletionTokens) * 1000 / float64(r.OKDurationMs)
	}
	return s
}
