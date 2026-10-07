package mailbox

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
)

const (
	overviewCacheTTL   = 30 * time.Second
	maxCachedOverviews = 1000
	// labelConcurrency reads label counts; each costs 1 quota unit.
	labelConcurrency = 20
	// labelHidden is a user label the person hid from Gmail's label list.
	labelHidden = "labelHide"
	labelUser   = "user"
	labelSystem = "system"
)

// SystemLabels are the Gmail folders the Acorn sidebar shows, in Gmail's order.
// The categories (CATEGORY_*), CHAT, and UNREAD stay out of the list.
var SystemLabels = []string{"INBOX", "STARRED", "SNOOZED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH"}

// Label is one Gmail label with its counts. Color is a hue family ("red",
// "blue", …) from the label's Gmail color, or "" when it has none.
type Label struct {
	ID     string
	Name   string
	Type   string
	Unread int
	Total  int
	Color  string
}

// Profile is the Google account behind a mailbox.
type Profile struct {
	Email   string
	Name    string
	Picture string
}

// Overview is everything the Gmail sidebar needs in one read.
type Overview struct {
	Profile Profile
	Labels  []Label
}

type gmailLabel struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Type                string `json:"type"`
	LabelListVisibility string `json:"labelListVisibility"`
	MessagesTotal       int    `json:"messagesTotal"`
	MessagesUnread      int    `json:"messagesUnread"`
	Color               struct {
		BackgroundColor string `json:"backgroundColor"`
	} `json:"color"`
}

// Overview reads the account's profile and its visible labels with counts. The
// label list and profile run together, then each label's counts in parallel.
func (g *Google) Overview(ctx context.Context, mailboxID, refreshToken string, fresh bool) (Overview, error) {
	g.init()
	if !fresh {
		if cached, ok := g.labels.get(mailboxID, time.Now()); ok {
			return cached, nil
		}
	}
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return Overview{}, err
	}
	var listed []gmailLabel
	var profile Profile
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		body, err := g.get(groupCtx, access, "/labels", nil)
		if err != nil {
			return fmt.Errorf("list gmail labels: %w", err)
		}
		var payload struct {
			Labels []gmailLabel `json:"labels"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return fmt.Errorf("decode gmail labels: %w", err)
		}
		listed = payload.Labels
		return nil
	})
	group.Go(func() error {
		// The profile is a nicety: an older grant without the profile scope only has the email.
		info, err := g.OAuth.Profile(groupCtx, access)
		if err != nil {
			slog.Warn("gmail profile", "error", err)
			return nil
		}
		profile = Profile{Email: info.Email, Name: info.Name, Picture: info.Picture}
		return nil
	})
	if err := group.Wait(); err != nil {
		return Overview{}, err
	}

	shown := visibleLabels(listed)
	counted := make([]Label, len(shown))
	counts, countsCtx := errgroup.WithContext(ctx)
	counts.SetLimit(labelConcurrency)
	for i, label := range shown {
		counts.Go(func() error {
			body, err := g.get(countsCtx, access, "/labels/"+url.PathEscape(label.ID), url.Values{
				"fields": {"id,messagesTotal,messagesUnread"},
			})
			if err != nil {
				return fmt.Errorf("read gmail label: %w", err)
			}
			var full gmailLabel
			if err := json.Unmarshal(body, &full); err != nil {
				return fmt.Errorf("decode gmail label: %w", err)
			}
			counted[i] = Label{
				ID:     label.ID,
				Name:   label.Name,
				Type:   label.Type,
				Unread: full.MessagesUnread,
				Total:  full.MessagesTotal,
				Color:  colorFamily(label.Color.BackgroundColor),
			}
			return nil
		})
	}
	if err := counts.Wait(); err != nil {
		return Overview{}, err
	}
	overview := Overview{Profile: profile, Labels: counted}
	g.labels.set(mailboxID, overview, time.Now())
	return overview, nil
}

// UserLabelIDs is the set of labels the person created.
func UserLabelIDs(labels []Label) map[string]bool {
	ids := make(map[string]bool, len(labels))
	for _, label := range labels {
		if label.Type == labelUser {
			ids[label.ID] = true
		}
	}
	return ids
}

// visibleLabels keeps the sidebar's system folders in Gmail's order, then the
// person's own labels by name, leaving out labels hidden in Gmail.
func visibleLabels(labels []gmailLabel) []gmailLabel {
	var system, user []gmailLabel
	for _, label := range labels {
		switch {
		case label.Type == labelUser && label.LabelListVisibility != labelHidden:
			user = append(user, label)
		case label.Type == labelSystem && slices.Contains(SystemLabels, label.ID):
			system = append(system, label)
		}
	}
	slices.SortFunc(system, func(a, b gmailLabel) int {
		return slices.Index(SystemLabels, a.ID) - slices.Index(SystemLabels, b.ID)
	})
	slices.SortFunc(user, func(a, b gmailLabel) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return append(system, user...)
}

// Hue bands (degrees) for Gmail's label palette, and the saturation below which
// a color reads as grey.
const (
	greySaturation = 0.15
	hueRed         = 15
	hueOrange      = 40
	hueYellow      = 65
	hueGreen       = 160
	hueTeal        = 185
	hueCyan        = 200
	hueBlue        = 250
	huePurple      = 290
	huePink        = 345
)

// colorFamily names the hue of a Gmail label color ("#4986e7" → "blue"), so the
// app can pick a design-system badge instead of painting Gmail's hex.
func colorFamily(hex string) string {
	hex = strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(hex) != 6 {
		return ""
	}
	value, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return ""
	}
	r := float64(value>>16&0xff) / 255
	g := float64(value>>8&0xff) / 255
	b := float64(value&0xff) / 255
	high, low := max(r, g, b), min(r, g, b)
	if high == 0 || (high-low)/high < greySaturation {
		return "neutral"
	}
	var hue float64
	switch high {
	case r:
		hue = 60 * (g - b) / (high - low)
	case g:
		hue = 60 * (2 + (b-r)/(high-low))
	default:
		hue = 60 * (4 + (r-g)/(high-low))
	}
	if hue < 0 {
		hue += 360
	}
	switch {
	case hue < hueRed || hue >= huePink:
		return "red"
	case hue < hueOrange:
		return "orange"
	case hue < hueYellow:
		return "yellow"
	case hue < hueGreen:
		return "green"
	case hue < hueTeal:
		return "teal"
	case hue < hueCyan:
		return "cyan"
	case hue < hueBlue:
		return "blue"
	case hue < huePurple:
		return "purple"
	default:
		return "pink"
	}
}
