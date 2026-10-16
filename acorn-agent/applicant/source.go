package applicant

import (
	"context"
	"errors"
)

// Where the applicant comes from. In development it is a profile.json and a folder of résumés on
// this computer (Store). In production it is the person's own account in acorn-backend (Backend):
// the agent holds no database, it asks the backend, with the person's own session, for their
// profile and files when a run starts and for a file when it is about to upload it.

// Auth is whose run it is. Token is the person's Acorn session, which the extension sends and the
// backend checks; the file store needs none.
type Auth struct {
	Token string
}

// Source is where a run reads the applicant from.
type Source interface {
	// SnapshotFor is the applicant as a run sees them: the profile as the model may read it, and
	// the files it may upload.
	SnapshotFor(ctx context.Context, auth Auth) (Snapshot, error)
	// ResumeFor is one file's description and bytes. An id that names no file is ErrNoResume.
	ResumeFor(ctx context.Context, auth Auth, id string) (Resume, []byte, error)
	// Kind is "files" or "backend", for the health route and the logs.
	Kind() string
}

// Kinds of Source.
const (
	KindFiles   = "files"
	KindBackend = "backend"
)

var (
	// ErrSignedOut is the backend refusing the person's session, or no session being given.
	ErrSignedOut = errors.New("sign in to Acorn to use your profile and résumés")
	// ErrBackend is the backend being unreachable or failing.
	ErrBackend = errors.New("acorn-backend could not be reached")
)

// SnapshotFor reads profile.json and lists the résumés; the folder needs no sign-in.
func (s *Store) SnapshotFor(ctx context.Context, _ Auth) (Snapshot, error) { return s.Snapshot(ctx) }

// ResumeFor reads one file of the résumé folder.
func (s *Store) ResumeFor(ctx context.Context, _ Auth, id string) (Resume, []byte, error) {
	return s.Resume(ctx, id)
}

// Kind says the applicant is read from files.
func (s *Store) Kind() string { return KindFiles }
