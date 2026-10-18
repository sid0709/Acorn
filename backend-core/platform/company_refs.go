package platform

import (
	"context"

	"github.com/sid0709/OpenSeat/backend-core/auth"
	"github.com/sid0709/OpenSeat/backend-core/jobs"
)

// companiesInUse lists the companies a member belongs to. The company copy keeps those published.
func companiesInUse(accounts *auth.Store) jobs.CompanyRefs {
	return func(ctx context.Context) ([]string, error) {
		return accounts.MemberCompanyIDs(ctx)
	}
}
