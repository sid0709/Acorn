package resume

import (
	"context"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// candidateTTL bounds how long a Library change made through another server
// process stays unseen by Recommend. Changes through this process clear it at once.
const candidateTTL = 5 * time.Minute

// candidateFields is all Recommend reads about a Library row: never the file or its text.
var candidateFields = bson.D{
	{Key: "id", Value: 1}, {Key: "accountId", Value: 1}, {Key: "title", Value: 1}, {Key: "source", Value: 1},
	{Key: "kind", Value: 1}, {Key: "fileName", Value: 1}, {Key: "analyzed", Value: 1},
	{Key: "isPrimary", Value: 1}, {Key: "skills", Value: 1}, {Key: "skillProfile", Value: 1},
}

// candidateCache keeps each account's uploaded Library rows for Recommend.
type candidateCache struct {
	mu   sync.Mutex
	rows map[string]cachedCandidates
}

type cachedCandidates struct {
	rows []LibraryRow
	at   time.Time
}

// libraryCandidates is the account's uploaded Library rows with only the fields
// Recommend describes, cached for candidateTTL.
func (s *Store) libraryCandidates(accountID string) []LibraryRow {
	s.candidates.mu.Lock()
	cached, ok := s.candidates.rows[accountID]
	s.candidates.mu.Unlock()
	if ok && time.Since(cached.at) < candidateTTL {
		return cached.rows
	}
	rows := uploadedLibrary(s.loadCandidates(accountID))
	s.candidates.mu.Lock()
	if s.candidates.rows == nil {
		s.candidates.rows = map[string]cachedCandidates{}
	}
	s.candidates.rows[accountID] = cachedCandidates{rows: rows, at: time.Now()}
	s.candidates.mu.Unlock()
	return rows
}

func (s *Store) loadCandidates(accountID string) []LibraryRow {
	if s.db == nil {
		return s.listLibrary(accountID)
	}
	ctx := context.Background()
	cur, err := s.db.Collection(libraryCollection).Find(ctx, bson.D{{Key: "accountId", Value: accountID}},
		options.Find().SetProjection(candidateFields))
	if err != nil {
		return nil
	}
	defer cur.Close(ctx)
	var rows []LibraryRow
	if err := cur.All(ctx, &rows); err != nil {
		return nil
	}
	return rows
}

// forgetCandidates drops an account's cached rows after its Library changes.
func (s *Store) forgetCandidates(accountID string) {
	s.candidates.mu.Lock()
	delete(s.candidates.rows, accountID)
	s.candidates.mu.Unlock()
}
