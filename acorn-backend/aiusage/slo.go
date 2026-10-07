package aiusage

// SLO statuses. AtRisk is a miss within atRiskSlack of the target's error budget.
const (
	SLOMet      = "met"
	SLOAtRisk   = "at_risk"
	SLOBreached = "breached"
	SLONoData   = "no_data"

	sloAtLeast = "at_least"
	sloAtMost  = "at_most"

	unitRate = "rate"
	unitMs   = "ms"

	// atRiskSlack is how far past the target, as a share of the target's budget,
	// still counts as at risk rather than breached.
	atRiskSlack = 0.5
)

// SLO is one service-level objective and how the period measured against it.
type SLO struct {
	Key        string  `json:"key"`
	Label      string  `json:"label"`
	Comparator string  `json:"comparator"`
	Unit       string  `json:"unit"`
	Target     float64 `json:"target"`
	Actual     float64 `json:"actual"`
	Status     string  `json:"status"`
}

type sloTarget struct {
	key, label, comparator, unit string
	target                       float64
	actual                       func(Summary) float64
}

// sloTargets are the objectives the console reports. Change targets here only.
var sloTargets = []sloTarget{
	{"success_rate", "Success rate", sloAtLeast, unitRate, 0.99, func(s Summary) float64 { return s.SuccessRate }},
	{"p95_latency", "p95 latency", sloAtMost, unitMs, 5000, func(s Summary) float64 { return float64(s.P95Ms) }},
	{"truncation_rate", "Truncated answers", sloAtMost, unitRate, 0.01, func(s Summary) float64 { return s.TruncationRate }},
	{"retry_rate", "Calls needing a retry", sloAtMost, unitRate, 0.05, func(s Summary) float64 { return s.RetryRate }},
}

func evaluateSLOs(s Summary) []SLO {
	out := make([]SLO, 0, len(sloTargets))
	for _, t := range sloTargets {
		slo := SLO{Key: t.key, Label: t.label, Comparator: t.comparator, Unit: t.unit, Target: t.target, Status: SLONoData}
		if s.Calls > 0 {
			slo.Actual = t.actual(s)
			slo.Status = sloStatus(t, slo.Actual)
		}
		out = append(out, slo)
	}
	return out
}

func sloStatus(t sloTarget, actual float64) string {
	var miss, budget float64
	if t.comparator == sloAtLeast {
		miss, budget = t.target-actual, 1-t.target
	} else {
		miss, budget = actual-t.target, t.target
	}
	switch {
	case miss <= 0:
		return SLOMet
	case miss <= budget*atRiskSlack:
		return SLOAtRisk
	}
	return SLOBreached
}
