package agent

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"sort"
	"strings"
)

// A survey is the whole page as screenshots from top to bottom, each at its own scroll position.
// A model that sees one screen at a time spends a call on every scroll and every dropdown; given
// the whole page it can plan the form in one answer. Each action then names the screen its point
// was measured on, and the extension scrolls there first.

const (
	// maxSurveyScreens bounds the screens one survey may carry.
	maxSurveyScreens = 12
	// maxStopScrolls is how many scroll actions a run that ends may still send, to bring what the
	// person must act on into view.
	maxStopScrolls = 2
)

// imageSize reads an image data URL's size without decoding its pixels.
func imageSize(dataURL string) (width, height int, err error) {
	comma := strings.IndexByte(dataURL, ',')
	if !strings.HasPrefix(dataURL, "data:image/") || comma < 0 {
		return 0, 0, fmt.Errorf("not an image data URL")
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil {
		return 0, 0, fmt.Errorf("not valid base64: %w", err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return 0, 0, fmt.Errorf("not a readable image: %w", err)
	}
	return config.Width, config.Height, nil
}

// checkSurvey validates a survey and returns its scroll positions, top to bottom. Every screen
// must be the size of the viewport: the model's points are measured in them.
func checkSurvey(obs Observation) ([]float64, error) {
	if len(obs.Survey) == 0 {
		return nil, nil
	}
	if len(obs.Survey) > maxSurveyScreens {
		return nil, fmt.Errorf("%w: the survey has %d screens; at most %d", ErrBadObservation, len(obs.Survey), maxSurveyScreens)
	}
	sort.SliceStable(obs.Survey, func(i, j int) bool { return obs.Survey[i].ScrollY < obs.Survey[j].ScrollY })
	positions := make([]float64, len(obs.Survey))
	for i, screen := range obs.Survey {
		width, height, err := imageSize(screen.Screenshot)
		if err != nil {
			return nil, fmt.Errorf("%w: survey screen %d is %v", ErrBadObservation, i+1, err)
		}
		if abs(width-obs.Viewport.Width) > sizeTolerance || abs(height-obs.Viewport.Height) > sizeTolerance {
			return nil, fmt.Errorf("%w: survey screen %d is %dx%d pixels but the viewport says %dx%d",
				ErrBadObservation, i+1, width, height, obs.Viewport.Width, obs.Viewport.Height)
		}
		positions[i] = screen.ScrollY
	}
	return positions, nil
}

// surveyNote tells the model what its screenshots are.
func surveyNote(obs Observation) string {
	var out strings.Builder
	fmt.Fprintf(&out, "This look is a survey of the whole page: %d screenshots, top to bottom", len(obs.Survey))
	showing := 0
	best := -1.0
	for i, screen := range obs.Survey {
		fmt.Fprintf(&out, "; screen %d is scrolled to %.0f px", i+1, screen.ScrollY)
		if d := abs(int(screen.ScrollY) - int(obs.Viewport.ScrollY)); best < 0 || float64(d) < best {
			best, showing = float64(d), i+1
		}
	}
	fmt.Fprintf(&out, ". The page shows screen %d now. Plan from all of them: give each click its \"screen\" (the screenshot its x and y are measured on) and Acorn scrolls there first. Do not scroll between screens yourself. %s", showing, badgeNote())
	return out.String()
}

// withoutSurvey takes the survey request out of a plan: it is not an action for the extension.
func withoutSurvey(actions []Action) (kept []Action, asked bool) {
	for _, action := range actions {
		if action.Kind == KindSurvey {
			asked = true
			continue
		}
		kept = append(kept, action)
	}
	return kept, asked
}

// scrollOnly keeps the first max scroll actions of a plan: all a run that ends may still do.
func scrollOnly(actions []Action, max int) []Action {
	var kept []Action
	for _, action := range actions {
		if action.Kind == KindScroll && len(kept) < max {
			kept = append(kept, action)
		}
	}
	return kept
}

// encodeBase64 is the standard base64 text of bytes.
func encodeBase64(raw []byte) string { return base64.StdEncoding.EncodeToString(raw) }

// decodeDataURL is the bytes of a base64 data URL.
func decodeDataURL(dataURL string) ([]byte, bool) {
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return nil, false
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	return raw, err == nil
}
