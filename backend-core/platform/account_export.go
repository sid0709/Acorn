package platform

import (
	"context"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/auth"
	"github.com/sid0709/OpenSeat/backend-core/candidate"
)

// Collector reads the rows an Acorn account owns.
type Collector struct {
	People *candidate.Store
}

// Collect implements auth.AccountSource.
func (c Collector) Collect(ctx context.Context, user auth.User, now time.Time) (auth.AccountExport, error) {
	bundle := auth.EmptyExport(user, now)
	if c.People != nil {
		snap, err := c.People.ExportUser(ctx, user.ID)
		if err != nil {
			return auth.AccountExport{}, err
		}
		if snap.Profile != nil {
			bundle.Profile = snap.Profile
		}
		bundle.Resumes = snap.Resumes
		bundle.SavedJobs = snap.SavedJobs
		bundle.Applications = snap.Applications
		bundle.Interviews = snap.Interviews
		bundle.Calendar = snap.Calendar
		bundle.Messages = snap.Messages
	}
	return bundle, nil
}
