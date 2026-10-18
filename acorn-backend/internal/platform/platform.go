// Package platform opens the shared database and builds the stores Acorn's server uses over it.
package platform

import (
	"context"
	"fmt"

	"github.com/sid0709/OpenSeat/acorn-backend/internal/database"
	"github.com/sid0709/OpenSeat/acorn-backend/internal/jobs"
	"github.com/sid0709/OpenSeat/acorn-backend/internal/killswitch"
	"github.com/sid0709/OpenSeat/backend-core/config"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// Platform is a database connection and the stores built over it.
type Platform struct {
	client *mongo.Client

	// Jobs is the job catalog the extension reads a posting from.
	Jobs *jobs.Store
	// KillSwitches are runtime feature toggles. Env is the default; Mongo can override.
	KillSwitches *killswitch.Store
}

// Open connects to the database and builds the stores.
func Open(ctx context.Context, db config.Database) (*Platform, error) {
	client, err := database.Connect(ctx, db.MongoURI)
	if err != nil {
		return nil, fmt.Errorf("mongo: %w", err)
	}
	listings := jobs.NewStore(client, db.DestDB, db.JobsCollection, db.CompaniesCollection)
	return &Platform{
		client:       client,
		Jobs:         listings,
		KillSwitches: killswitch.NewStore(client, db.DestDB, killswitch.LoadDefaults()),
	}, nil
}

// Mongo returns the shared database client.
func (p *Platform) Mongo() *mongo.Client {
	return p.client
}

// Close disconnects from the database.
func (p *Platform) Close() {
	_ = p.client.Disconnect(context.Background())
}
