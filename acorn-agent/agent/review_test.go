package agent

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestTheFieldsAPlanFillsInAreWhatEachZoneIsReviewedAgainst(t *testing.T) {
	plan := []Action{
		{Kind: KindClick, Label: "First Name", Zone: 1, X: fp(1), Y: fp(1)}, {Kind: KindType, Text: "Ada", Zone: 1},
		{Kind: KindClick, Label: "Password", Zone: 1, X: fp(2), Y: fp(2)}, {Kind: KindType, Text: "hunter2", Secret: true, Zone: 1},
		{Kind: KindChoose, Label: "Country", Text: "Canada", Zone: 2, X: fp(3), Y: fp(3)},
		{Kind: KindClick, Label: "Phone", Zone: 2, X: fp(4), Y: fp(4)}, {Kind: KindType, Text: "555", Zone: 2}, {Kind: KindType, Text: "again", Zone: 2},
		{Kind: KindClick, X: fp(5), Y: fp(5), Zone: 3}, {Kind: KindType, Text: "no label", Zone: 3},
		{Kind: KindClick, Label: "Notes", X: fp(6), Y: fp(6)}, {Kind: KindType, Text: "no zone"},
	}
	got := expectationsOf(plan)
	if len(got) != 2 || len(got[1]) != 1 || got[1][0] != (expectation{"First Name", "Ada"}) {
		t.Fatalf("zone 1 = %+v: a secret and a dropdown are not asked about", got[1])
	}
	if len(got[2]) != 1 || got[2][0] != (expectation{"Phone", "555"}) {
		t.Fatalf("zone 2 = %+v: only the first thing typed after a point belongs to its label", got[2])
	}
}

func fp(v float64) *float64 { return &v }

// fastPlan is a plan that fills a field on each of screens 1 and 2.
func fastPlan() string {
	return plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		labelled(2, 100, 200, "Last Name"), typeAction("Lovelace", nil),
	)
}

func runUntilReviewed(t *testing.T, screen *fakeScreen, cfg Config) (*Agent, *scriptedModel, string) {
	t.Helper()
	model := &scriptedModel{replies: []string{fastPlan(), plan("next", nil, click(5, 5, nil))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, cfg)
	id := startFast(t, a, true)
	stepOK(t, a, id, surveyObservation(t))
	return a, model, id
}

func TestAZonePhotoSentMidBatchIsReviewedAndWhatIsWrongIsToldAtTheNextLook(t *testing.T) {
	screen := &fakeScreen{wrongFields: []string{"Lovelace"}}
	a, model, id := runUntilReviewed(t, screen, DefaultConfig())
	for zone := 1; zone <= 2; zone++ {
		if err := a.ReceiveShot(context.Background(), id, ShotUpload{Kind: ShotZone, Zone: zone, Screenshot: shot(t, uint8(60+zone))}); err != nil {
			t.Fatal(err)
		}
	}
	step := stepOK(t, a, id, observation(shot(t, 140)))
	if screen.reviewRequests != 2 {
		t.Fatalf("%d reviews, want one for each zone", screen.reviewRequests)
	}
	text := lastText(model)
	if !strings.Contains(text, `"Last Name" does not show "Lovelace" (screen 2)`) || strings.Contains(text, `"First Name" does not show`) {
		t.Fatalf("the model was not told which field is wrong:\n%s", text)
	}
	s, _ := a.sessions.get(id)
	if s.usage.Checks < 2 {
		t.Fatalf("the reviews were not counted: %d", s.usage.Checks)
	}
	if !step.Survey {
		t.Fatal("the look after a failed review is not a survey")
	}
}

func TestFieldsThatShowWhatWasTypedAreNotTold(t *testing.T) {
	screen := &fakeScreen{}
	a, model, id := runUntilReviewed(t, screen, DefaultConfig())
	_ = a.ReceiveShot(context.Background(), id, ShotUpload{Kind: ShotZone, Zone: 1, Screenshot: shot(t, 70)})
	stepOK(t, a, id, observation(shot(t, 140)))
	if strings.Contains(lastText(model), "looked at each part of the page") {
		t.Fatalf("a review that found nothing was told:\n%s", lastText(model))
	}
}

func TestAZonePhotoThatComesTwiceIsReviewedOnce(t *testing.T) {
	screen := &fakeScreen{}
	a, _, id := runUntilReviewed(t, screen, DefaultConfig())
	_ = a.ReceiveShot(context.Background(), id, ShotUpload{Kind: ShotZone, Zone: 1, Screenshot: shot(t, 70)})
	look := observation(shot(t, 140))
	look.ZoneShots = []ZoneShot{{Zone: 1, Screenshot: shot(t, 70)}, {Zone: 2, Screenshot: shot(t, 80)}}
	stepOK(t, a, id, look)
	if screen.reviewRequests != 2 {
		t.Fatalf("%d reviews: zone 1 came mid-batch and with the look, zone 2 only with the look", screen.reviewRequests)
	}
}

func TestReviewsAreOnlyForFastFill(t *testing.T) {
	off := &fakeScreen{}
	model := &scriptedModel{replies: []string{fastPlan(), plan("next", nil, click(5, 5, nil))}}
	b := newAgentWithScreen(t, model, &fixedDecider{}, off, DefaultConfig())
	bid := startFast(t, b, false)
	stepOK(t, b, bid, surveyObservation(t))
	_ = b.ReceiveShot(context.Background(), bid, ShotUpload{Kind: ShotZone, Zone: 1, Screenshot: shot(t, 70)})
	if off.reviewRequests != 0 {
		t.Fatal("a run without fast fill was reviewed")
	}
}

func TestAPictureThatIsNotTheWindowsSizeIsDroppedAndAnUnknownKindIsRefused(t *testing.T) {
	screen := &fakeScreen{}
	a, _, id := runUntilReviewed(t, screen, DefaultConfig())
	if err := a.ReceiveShot(context.Background(), id, ShotUpload{Kind: ShotZone, Zone: 1, Screenshot: "data:image/jpeg;base64,AAAA"}); err != nil {
		t.Fatalf("a picture that is not an image was an error: %v", err)
	}
	if err := a.ReceiveShot(context.Background(), id, ShotUpload{Kind: "mystery", Screenshot: shot(t, 70)}); err == nil {
		t.Fatal("an unknown kind was accepted")
	}
	if err := a.ReceiveShot(context.Background(), id, ShotUpload{Kind: ShotSnap, Screenshot: shot(t, 70)}); err == nil {
		t.Fatal("a snap with no action was accepted")
	}
	if err := a.ReceiveShot(context.Background(), "nope", ShotUpload{Kind: ShotZone, Screenshot: shot(t, 70)}); !errors.Is(err, ErrNoSession) {
		t.Fatalf("unknown session: %v", err)
	}
	if screen.reviewRequests != 0 {
		t.Fatal("a picture that is not an image was reviewed")
	}
	if err := a.ReceiveShot(context.Background(), id, ShotUpload{Kind: ShotSnap, ID: "s1ch1", Screenshot: shot(t, 70)}); err != nil {
		t.Fatal(err)
	}
	if s, _ := a.sessions.get(id); s.snaps["s1ch1"].Screenshot == "" {
		t.Fatal("a snap was not kept")
	}
}
