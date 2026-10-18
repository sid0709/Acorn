// Package jobs reads a job posting from the shared catalog.
package jobs

import (
	"context"
	"errors"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

// ErrNotFound is returned when no public job has the id.
var ErrNotFound = errors.New("job not found")

// Store reads jobs and the logo of the company that posted them.
type Store struct {
	client              *mongo.Client
	db                  string
	jobsCollection      string
	companiesCollection string
}

// NewStore reads jobs from jobsCollection and company logos from companiesCollection, both in db.
func NewStore(client *mongo.Client, db, jobsCollection, companiesCollection string) *Store {
	return &Store{client: client, db: db, jobsCollection: jobsCollection, companiesCollection: companiesCollection}
}

// Ping reports whether the database answers.
func (s *Store) Ping(ctx context.Context) error {
	return s.client.Ping(ctx, nil)
}

func (s *Store) jobs() *mongo.Collection {
	return s.client.Database(s.db).Collection(s.jobsCollection)
}

func (s *Store) companies() *mongo.Collection {
	return s.client.Database(s.db).Collection(s.companiesCollection)
}
