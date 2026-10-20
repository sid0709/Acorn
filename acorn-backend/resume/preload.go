package resume

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	// preloadWorkers is how many accounts load at once. Each read is a few round trips to Mongo,
	// so loading side by side hides the distance to it.
	preloadWorkers = 4
	// preloadLogEvery is how many loaded accounts pass between progress lines.
	preloadLogEvery = 25
	// accountReadTimeout bounds one account's read from Mongo.
	accountReadTimeout = 2 * time.Minute
)

// PreloadReport is what Preload did.
type PreloadReport struct {
	// Accounts and Files are what was read into memory, Bytes their size.
	Accounts, Files int
	Bytes           int64
	// Skipped is accounts left for their first request because the cap would be passed.
	Skipped int
	Elapsed time.Duration
}

// accountSize is how much Library an account holds.
type accountSize struct {
	ID    string
	Files int
	Bytes int64
}

// planPreload orders the accounts to load: first those named (in the order given), then the rest
// as listed (most recently uploaded first). An account that would take the load past budget bytes
// is left out, and so is one with no files.
func planPreload(all []accountSize, first []string, budget int64) (plan []accountSize, skipped int) {
	byID := make(map[string]accountSize, len(all))
	for _, account := range all {
		byID[account.ID] = account
	}
	var ordered []accountSize
	taken := map[string]bool{}
	for _, id := range first {
		if account, ok := byID[id]; ok && !taken[id] {
			taken[id] = true
			ordered = append(ordered, account)
		}
	}
	for _, account := range all {
		if !taken[account.ID] {
			taken[account.ID] = true
			ordered = append(ordered, account)
		}
	}
	var used int64
	for _, account := range ordered {
		if account.Files == 0 {
			continue
		}
		if used+account.Bytes > budget {
			skipped++
			continue
		}
		used += account.Bytes
		plan = append(plan, account)
	}
	return plan, skipped
}

// ingestAccount puts an account's Library rows into memory: each file with its bytes, and the
// list of rows without them, which is what the website and the agent read first.
func (s *Store) ingestAccount(accountID string, rows []LibraryRow) (files int, bytes int64) {
	list := make([]LibraryRow, 0, len(rows))
	for _, row := range rows {
		if len(row.Bytes) > 0 {
			s.files.put(fileKey(accountID, row.ID), row)
			files++
			bytes += int64(len(row.Bytes))
		}
		row.Bytes = nil
		list = append(list, row)
	}
	s.reads.put(libraryCollection, accountID, list)
	return files, bytes
}

// accountSizes lists every account that has Library rows, most recently uploaded first, with the
// bytes it holds.
func (s *Store) accountSizes(ctx context.Context) ([]accountSize, error) {
	cursor, err := s.db.Collection(libraryCollection).Aggregate(ctx, bson.A{
		bson.D{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$accountId"},
			{Key: "files", Value: bson.D{{Key: "$sum", Value: 1}}},
			{Key: "bytes", Value: bson.D{{Key: "$sum", Value: "$size"}}},
			{Key: "latest", Value: bson.D{{Key: "$max", Value: "$uploadedAt"}}},
		}}},
		bson.D{{Key: "$sort", Value: bson.D{{Key: "latest", Value: -1}}}},
	})
	if err != nil {
		return nil, fmt.Errorf("list the accounts with files: %w", err)
	}
	defer cursor.Close(ctx)
	var found []struct {
		ID    string `bson:"_id"`
		Files int    `bson:"files"`
		Bytes int64  `bson:"bytes"`
	}
	if err := cursor.All(ctx, &found); err != nil {
		return nil, fmt.Errorf("read the accounts with files: %w", err)
	}
	out := make([]accountSize, 0, len(found))
	for _, account := range found {
		out = append(out, accountSize{ID: account.ID, Files: account.Files, Bytes: account.Bytes})
	}
	return out, nil
}

// loadAccountLibrary reads all of an account's rows with their bytes in one query.
func (s *Store) loadAccountLibrary(ctx context.Context, accountID string) ([]LibraryRow, error) {
	ctx, cancel := context.WithTimeout(ctx, accountReadTimeout)
	defer cancel()
	cursor, err := s.db.Collection(libraryCollection).Find(ctx, bson.D{{Key: "accountId", Value: accountID}})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var rows []LibraryRow
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// Preload reads accounts' Library files into memory, so a request for one is served from it.
// first names the accounts to load first (those signed in lately); the rest follow, most recently
// uploaded first, until the cap on the cache would be passed. It does not hold up the server: run
// it in the background, and a request for an account not yet loaded reads its own files as before.
func (s *Store) Preload(ctx context.Context, first []string) PreloadReport {
	if s.db == nil {
		return PreloadReport{}
	}
	started := time.Now()
	all, err := s.accountSizes(ctx)
	if err != nil {
		slog.Error("library preload", "error", err)
		return PreloadReport{}
	}
	_, held := s.files.usage()
	budget := int64(s.files.limit()) - int64(held)
	plan, skipped := planPreload(all, first, budget)
	var total int64
	for _, account := range plan {
		total += account.Bytes
	}
	slog.Info("library preload starts", "accounts", len(plan), "bytes", total, "skippedForTheCap", skipped)

	var accounts, files, done atomic.Int64
	var bytes atomic.Int64
	work := make(chan accountSize)
	var wg sync.WaitGroup
	for range preloadWorkers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for account := range work {
				s.preloadAccount(ctx, account, &accounts, &files, &bytes)
				if n := done.Add(1); n%preloadLogEvery == 0 {
					slog.Info("library preload", "accounts", n, "of", len(plan), "bytes", bytes.Load(), "elapsed", time.Since(started).Round(time.Second))
				}
			}
		}()
	}
loading:
	for _, account := range plan {
		select {
		case work <- account:
		case <-ctx.Done():
			break loading
		}
	}
	close(work)
	wg.Wait()
	report := PreloadReport{
		Accounts: int(accounts.Load()), Files: int(files.Load()), Bytes: bytes.Load(),
		Skipped: skipped, Elapsed: time.Since(started),
	}
	slog.Info("library preload done", "accounts", report.Accounts, "files", report.Files, "bytes", report.Bytes,
		"skippedForTheCap", report.Skipped, "elapsed", report.Elapsed.Round(time.Second))
	return report
}

// preloadAccount reads one account and keeps it, unless its Library changed meanwhile: what was
// read is then older than what a request has put in memory, and is dropped.
func (s *Store) preloadAccount(ctx context.Context, account accountSize, accounts, files, bytes *atomic.Int64) {
	generation := s.libraryGeneration(account.ID)
	rows, err := s.loadAccountLibrary(ctx, account.ID)
	if err != nil {
		slog.Warn("library preload: an account was not read", "error", err)
		return
	}
	if s.libraryGeneration(account.ID) != generation {
		return
	}
	loaded, size := s.ingestAccount(account.ID, rows)
	accounts.Add(1)
	files.Add(int64(loaded))
	bytes.Add(size)
}

// Preload reads every account's Library files into memory; see Store.Preload.
func (s *Service) Preload(ctx context.Context, first []string) PreloadReport {
	return s.store.Preload(ctx, first)
}

// CacheUsage is how many Library files the server holds in memory and their bytes.
func (s *Service) CacheUsage() (files, bytes int) { return s.store.files.usage() }
