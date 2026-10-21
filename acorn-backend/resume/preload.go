package resume

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

const (
	// preloadWorkers is how many accounts load at once. Each read is a few round trips to Mongo,
	// so loading side by side hides the distance to it.
	preloadWorkers = 4
	// accountReadTimeout bounds one account's read from Mongo.
	accountReadTimeout = 2 * time.Minute
)

// PreloadReport is what Preload did.
type PreloadReport struct {
	// Accounts and Files are what was read into memory, Bytes their size.
	Accounts, Files int
	Bytes           int64
	// Skipped is accounts left for their first request because the cap would be passed; Failed is
	// accounts whose read did not finish, which also wait for their first request.
	Skipped, Failed int
	Elapsed         time.Duration
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
		slog.Error("Could not list the accounts to preload, so no library was loaded ahead of time", plainlog.ErrorKey, readFailure(err))
		return PreloadReport{}
	}
	_, held := s.files.usage()
	budget := int64(s.files.limit()) - int64(held)
	plan, skipped := planPreload(all, first, budget)
	var total int64
	for _, account := range plan {
		total += account.Bytes
	}
	slog.Info(fmt.Sprintf("Loading the résumé libraries of %s (%s) into memory in the background. The server answers meanwhile, and an account that is not loaded yet reads its own files when it is first used.",
		plainlog.Count(len(plan), "account"), plainlog.Bytes(total)))
	if skipped > 0 {
		slog.Warn(fmt.Sprintf("%s will not be preloaded because the memory cap for résumé files would be passed; they load when first used.", plainlog.Count(skipped, "account")))
	}

	var accounts, files, failed atomic.Int64
	var bytes atomic.Int64
	work := make(chan accountSize)
	var wg sync.WaitGroup
	for range preloadWorkers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for account := range work {
				if !s.preloadAccount(ctx, account, &accounts, &files, &bytes) {
					failed.Add(1)
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
		Skipped: skipped, Failed: int(failed.Load()), Elapsed: time.Since(started),
	}
	line := fmt.Sprintf("Finished loading libraries: %d of %d accounts, %s, %s, in %s.",
		report.Accounts, len(plan), plainlog.Count(report.Files, "file"), plainlog.Bytes(report.Bytes), plainlog.Seconds(report.Elapsed))
	if report.Failed > 0 {
		line += fmt.Sprintf(" %s could not be read and will load when first used.", plainlog.Count(report.Failed, "account"))
	}
	slog.Info(line)
	return report
}

// preloadAccount reads one account and keeps it, unless its Library changed meanwhile: what was
// read is then older than what a request has put in memory, and is dropped. It says whether the
// account is now in memory or was dropped for a newer copy (false means the read failed).
func (s *Store) preloadAccount(ctx context.Context, account accountSize, accounts, files, bytes *atomic.Int64) bool {
	started := time.Now()
	who := "account " + plainlog.Short(account.ID)
	generation := s.libraryGeneration(account.ID)
	rows, err := s.loadAccountLibrary(ctx, account.ID)
	if err != nil {
		slog.Warn(fmt.Sprintf("Could not read the library of %s (%s) after %s, so it will load when that person first needs it.",
			who, plainlog.Count(account.Files, "file"), plainlog.Seconds(time.Since(started))), plainlog.ErrorKey, readFailure(err))
		return false
	}
	if s.libraryGeneration(account.ID) != generation {
		slog.Info(fmt.Sprintf("The library of %s changed while it was being read, so the newer copy in memory was kept.", who))
		return true
	}
	loaded, size := s.ingestAccount(account.ID, rows)
	accounts.Add(1)
	files.Add(int64(loaded))
	bytes.Add(size)
	slog.Info(fmt.Sprintf("Loaded the library of %s: %s, %s, in %s.",
		who, plainlog.Count(loaded, "file"), plainlog.Bytes(size), plainlog.Seconds(time.Since(started))))
	return true
}

// readFailure is why a read from the database failed, in words: a database that did not answer in
// time is said so, not as the driver's chain of repeated socket errors.
func readFailure(err error) string {
	text := err.Error()
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(text, "timeout") || strings.Contains(text, "deadline exceeded") {
		return "the database did not answer in time"
	}
	const most = 200
	if len(text) > most {
		text = text[:most] + "…"
	}
	return text
}

// Preload reads every account's Library files into memory; see Store.Preload.
func (s *Service) Preload(ctx context.Context, first []string) PreloadReport {
	return s.store.Preload(ctx, first)
}

// CacheUsage is how many Library files the server holds in memory and their bytes.
func (s *Service) CacheUsage() (files, bytes int) { return s.store.files.usage() }
