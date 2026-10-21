package agent

import (
	"context"
	"fmt"
	"log/slog"
)

// Pictures the extension sends while a batch of actions is still being carried out, not with the look that
// follows it, so the agent can be working on them meanwhile: a photo of a zone when its last action is done
// (reviewed on the side, review.go), and a photo of an open dropdown (probed, probe.go).

// What a shot is of.
const (
	// ShotZone is the page when the last action of a zone of a fast-fill plan was done.
	ShotZone = "zone"
	// ShotSnap is the page when a snap action of the agent's own was carried out: a dropdown opened to be looked at.
	ShotSnap = "snap"
)

// maxSnaps bounds the dropdown photos a session holds at once.
const maxSnaps = 64

// ShotUpload is one picture sent mid-batch.
type ShotUpload struct {
	Kind string `json:"kind"`
	// Zone is the survey screen of a zone shot; ID the action of a snap.
	Zone       int     `json:"zone,omitempty"`
	ID         string  `json:"id,omitempty"`
	Screenshot string  `json:"screenshot"`
	ScrollY    float64 `json:"scrollY"`
	// Focus is what the page said had focus when a snap was taken: a native list reports its options as text.
	Focus *Focus `json:"focus,omitempty"`
	// List is the list of choices open on the page when a snap was taken, as the page names its options;
	// nil when it names none (the picture is read instead).
	List *OpenList `json:"list,omitempty"`
}

// ReceiveShot takes a picture the extension sent mid-batch. A zone shot starts its review at once; a snap
// is kept for the probe that is waiting for it. A picture that is not an image the size of the page's
// window is dropped (the run goes on; it is looked at again after the plan).
func (a *Agent) ReceiveShot(ctx context.Context, id string, upload ShotUpload) error {
	s, ok := a.sessions.get(id)
	if !ok {
		return ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if s.viewport.Width > 0 {
		width, height, err := imageSize(upload.Screenshot)
		if err != nil || abs(width-s.viewport.Width) > sizeTolerance || abs(height-s.viewport.Height) > sizeTolerance {
			slog.Debug(runName(id) + ": a picture sent mid-batch was not the size of the window and was dropped.")
			return nil
		}
	}
	switch upload.Kind {
	case ShotZone:
		a.startReview(s, ZoneShot{Zone: upload.Zone, Screenshot: upload.Screenshot, ScrollY: upload.ScrollY})
	case ShotSnap:
		if upload.ID == "" {
			return fmt.Errorf("%w: a snap has no action id", ErrBadObservation)
		}
		if s.snaps == nil {
			s.snaps = map[string]ShotUpload{}
		}
		if len(s.snaps) >= maxSnaps {
			s.snaps = map[string]ShotUpload{}
		}
		s.snaps[upload.ID] = upload
	default:
		return fmt.Errorf("%w: a shot of kind %q", ErrBadObservation, upload.Kind)
	}
	return nil
}
