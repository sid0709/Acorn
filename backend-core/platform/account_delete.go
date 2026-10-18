package platform

import (
	"context"

	"github.com/sid0709/OpenSeat/backend-core/candidate"
	"github.com/sid0709/OpenSeat/backend-core/jobs"
)

// accountEraser deletes an account's records together.
type accountEraser struct {
	people *candidate.Store
	jobs   *jobs.Store
}

func newAccountEraser(people *candidate.Store, jobsStore *jobs.Store) accountEraser {
	return accountEraser{people: people, jobs: jobsStore}
}

// DeleteUser removes the person and everything that exists only because of them.
// ownedCompanyID is the company page they created; it is deleted with its jobs
// and the activity on those jobs.
func (e accountEraser) DeleteUser(ctx context.Context, userID, ownedCompanyID string) error {
	var jobIDs []string
	if ownedCompanyID != "" {
		companyJobs, err := e.jobs.DeleteByCompany(ctx, ownedCompanyID)
		if err != nil {
			return err
		}
		jobIDs = companyJobs
		if err := e.people.DeleteCompany(ctx, ownedCompanyID); err != nil {
			return err
		}
	}
	if err := e.people.DeleteJobs(ctx, jobIDs); err != nil {
		return err
	}
	return e.people.DeleteUser(ctx, userID)
}
