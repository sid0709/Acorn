package resume

import (
	"sort"
	"strings"
	"time"
)

func filterHistory(rows []Generation, query HistoryQuery) []Generation {
	out := make([]Generation, 0, len(rows))
	search := strings.ToLower(strings.TrimSpace(query.Search))
	searchIn := query.SearchIn
	if searchIn == "" {
		searchIn = "all"
	}
	for _, row := range rows {
		if status := strings.TrimSpace(query.Status); status != "" && status != "all" && row.Status != status {
			continue
		}
		if query.Model != "" && row.Model != query.Model {
			continue
		}
		if query.Provider != "" && row.Provider != query.Provider {
			continue
		}
		if query.TemplateID != "" && row.TemplateID != query.TemplateID {
			continue
		}
		if !query.From.IsZero() && row.StartedAt.Before(query.From) {
			continue
		}
		if !query.To.IsZero() && row.StartedAt.After(query.To) {
			continue
		}
		if search != "" && !matchSearch(row, search, searchIn) {
			continue
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool {
		switch query.Sort {
		case "oldest":
			return out[i].StartedAt.Before(out[j].StartedAt)
		default:
			return out[i].StartedAt.After(out[j].StartedAt)
		}
	})
	return out
}

func matchSearch(row Generation, search, searchIn string) bool {
	jd := strings.ToLower(row.JobDescription)
	resume := resumeSearchText(row)
	switch searchIn {
	case "jd":
		return strings.Contains(jd, search)
	case "resume":
		return strings.Contains(resume, search)
	default:
		return strings.Contains(jd, search) || strings.Contains(resume, search) || strings.Contains(strings.ToLower(row.TechStack), search)
	}
}

func historyFacets(rows []Generation) map[string]any {
	models := map[string]bool{}
	providers := map[string]bool{}
	templates := map[string]bool{}
	completed, failed := 0, 0
	for _, row := range rows {
		if row.Model != "" {
			models[row.Model] = true
		}
		if row.Provider != "" {
			providers[row.Provider] = true
		}
		if row.TemplateID != "" {
			templates[row.TemplateID] = true
		}
		if row.Status == "completed" {
			completed++
		}
		if row.Status == "failed" {
			failed++
		}
	}
	return map[string]any{
		"models":       keys(models),
		"providers":    keys(providers),
		"templates":    keys(templates),
		"statusCounts": map[string]int{"completed": completed, "failed": failed},
		"stats":        map[string]any{"completed": completed, "totalTokens": 0, "totalCost": 0},
	}
}

func keys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func pageSlice[T any](rows []T, limit, offset int) []T {
	if offset > len(rows) {
		return []T{}
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	return rows[offset:end]
}

func parseDay(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	day, err := time.Parse("2006-01-02", value)
	if err != nil {
		t, err := time.Parse(time.RFC3339, value)
		if err != nil {
			return time.Time{}
		}
		return t
	}
	return day
}
