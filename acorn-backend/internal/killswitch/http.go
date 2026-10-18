package killswitch

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrUnknown is a staff flip of a name that is not in Names.
	ErrUnknown = errors.New("unknown kill switch")
	// ErrNoStore means this process has no Mongo (or memory) switch store.
	ErrNoStore = errors.New("kill switches are unavailable")
)

// Switches is the runtime lookup staff and handlers share. Nil means every
// feature is on. *Store and *Memory implement it.
type Switches interface {
	Enabled(ctx context.Context, name Name) bool
	List(ctx context.Context) ([]State, error)
	Set(ctx context.Context, name Name, enabled bool, actor, note string, now time.Time) (Result, error)
}

// On reports whether name may run. A nil Switches is on.
func On(switches Switches, ctx context.Context, name Name) bool {
	if switches == nil {
		return true
	}
	return switches.Enabled(ctx, name)
}
