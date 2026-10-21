package runs

import (
	"context"
	"sort"
	"sync"
	"time"
)

// NewMemory keeps the Runs in this process only.
func NewMemory() *Store {
	return &Store{db: &memoryBackend{}, now: time.Now}
}

type memoryBackend struct {
	mu   sync.Mutex
	rows []Entry
}

func (m *memoryBackend) insert(_ context.Context, entry Entry) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, row := range m.rows {
		if row.AccountID == entry.AccountID && row.RecordID == entry.RecordID {
			return false, nil
		}
	}
	m.rows = append(m.rows, entry)
	return true, nil
}

func (m *memoryBackend) daily(_ context.Context, accountID, from, to string) ([]Day, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	byDay := map[string]*Day{}
	for _, row := range m.rows {
		if row.AccountID != accountID || row.Day < from || row.Day > to {
			continue
		}
		day := byDay[row.Day]
		if day == nil {
			day = &Day{Day: row.Day}
			byDay[row.Day] = day
		}
		day.Count++
		day.DurationMs += row.DurationMs
		day.CostNanos += row.CostNanos
	}
	days := make([]Day, 0, len(byDay))
	for _, day := range byDay {
		days = append(days, *day)
	}
	sort.Slice(days, func(i, j int) bool { return days[i].Day < days[j].Day })
	return days, nil
}

func (m *memoryBackend) recent(_ context.Context, accountID string, limit int) ([]Entry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var entries []Entry
	for _, row := range m.rows {
		if row.AccountID == accountID {
			entries = append(entries, row)
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].EndedAt.After(entries[j].EndedAt) })
	if len(entries) > limit {
		entries = entries[:limit]
	}
	return entries, nil
}
