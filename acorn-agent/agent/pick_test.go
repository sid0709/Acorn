package agent

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/decide"
)

// pickScreen answers the choice questions from a script: for each question key, the probabilities.
type pickScreen struct {
	mu       sync.Mutex
	requests []decide.Request
	probs    map[string]map[string]float64
	yes      map[string]float64
}

func (p *pickScreen) Name() string { return "pick-screen" }

func (p *pickScreen) Decide(_ context.Context, req decide.Request) (decide.Response, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, req)
	answers := map[string]decide.Answer{}
	for key, question := range req.Questions {
		if question.Type == decide.TypeNoul {
			v := p.yes[key]
			answers[key] = decide.Answer{Type: decide.TypeNoul, Noul: &v}
			continue
		}
		answers[key] = decide.Answer{Type: decide.TypeChoice, Probabilities: p.probs[key]}
	}
	return decide.Response{Answers: answers}, nil
}

func newPickAgent(t *testing.T, screen *pickScreen) (*Agent, string) {
	t.Helper()
	model := &scriptedModel{replies: []string{classified(), classified()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", Prefill: true})
	if err != nil {
		t.Fatal(err)
	}
	return a, started.SessionID
}

func TestAClearOptionIsChosenAndADoubtfulOneIsLeftToTheDrivingModel(t *testing.T) {
	screen := &pickScreen{probs: map[string]map[string]float64{
		"q1": {"o0": 0.05, "o1": 0.9, "o2": 0.03, "none": 0.02},
		"q2": {"o0": 0.4, "o1": 0.35, "none": 0.25},
	}}
	a, id := newPickAgent(t, screen)
	result, err := a.Pick(context.Background(), id, PickRequest{URL: "https://jobs.example/apply", Fields: []PickField{
		{Ref: 1, Kind: PickOne, Question: "Highest degree", Options: []string{"High school", "Bachelor's", "Master's"}},
		{Ref: 2, Kind: PickOne, Question: "Are you over 18?", Options: []string{"Yes", "No"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Picks) != 1 || result.Picks[0].Ref != 1 || len(result.Picks[0].Choices) != 1 || result.Picks[0].Choices[0] != 1 {
		t.Fatalf("picks = %+v: only the clear answer is chosen", result.Picks)
	}
	// The decision model reads the applicant's details and the question with its options, nothing else.
	state := screen.requests[0].State[0].Text
	if !strings.Contains(state, "Ada Lovelace") {
		t.Fatalf("the details are not in the state: %s", state)
	}
	question := screen.requests[0].Questions["q1"]
	if question.Criteria["o1"] != "Bachelor's" || !strings.Contains(question.Instructions, "Highest degree") || !strings.Contains(question.Instructions, "never used AI") {
		t.Fatalf("question = %+v", question)
	}
}

func TestEveryOptionOfAGroupOfCheckboxesIsAYesOrANo(t *testing.T) {
	screen := &pickScreen{yes: map[string]float64{"q3o0": 0.95, "q3o1": 0.1, "q3o2": 0.8}}
	a, id := newPickAgent(t, screen)
	result, err := a.Pick(context.Background(), id, PickRequest{Fields: []PickField{
		{Ref: 3, Kind: PickMany, Question: "Languages you speak", Options: []string{"English", "French", "Spanish"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Picks) != 1 || len(result.Picks[0].Choices) != 2 || result.Picks[0].Choices[0] != 0 || result.Picks[0].Choices[1] != 2 {
		t.Fatalf("picks = %+v", result.Picks)
	}
}

func TestAFieldWithOneOptionOrNoOptionsIsNotAsked(t *testing.T) {
	screen := &pickScreen{}
	a, id := newPickAgent(t, screen)
	result, err := a.Pick(context.Background(), id, PickRequest{Fields: []PickField{
		{Ref: 1, Kind: PickOne, Question: "Only", Options: []string{"Yes"}},
		{Ref: 2, Kind: PickOne, Question: "None"},
		{Ref: 3, Kind: "other", Question: "Odd", Options: []string{"a", "b"}},
		{Ref: 4, Kind: PickOne, Question: "  ", Options: []string{"a", "b"}},
	}})
	if err != nil || len(result.Picks) != 0 || len(screen.requests) != 0 {
		t.Fatalf("result = %+v err = %v requests = %d", result, err, len(screen.requests))
	}
}

func TestAYesToAQuestionAboutAIIsAskedAgainAsANo(t *testing.T) {
	// The classifier flags the question; the first answer is "Yes", so it is asked again with the no instruction.
	screen := &pickScreen{probs: map[string]map[string]float64{"q4": {"o0": 0.9, "o1": 0.08, "none": 0.02}}}
	model := &scriptedModel{replies: []string{classified(`{"element_index":4,"kind":"application_ai"}`)}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", Prefill: true})
	if err != nil {
		t.Fatal(err)
	}
	result, err := a.Pick(context.Background(), started.SessionID, PickRequest{Fields: []PickField{
		{Ref: 4, Kind: PickOne, Question: "Did you use AI to write this application?", Options: []string{"Yes", "No"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(screen.requests) != 2 || !strings.Contains(screen.requests[1].Questions["q4"].Instructions, "choose the option that says no") {
		t.Fatalf("the flagged question is asked again as a no: %d requests", len(screen.requests))
	}
	// The scripted answer is still "Yes" for the second ask, which is refused rather than clicked.
	if len(result.Picks) != 0 {
		t.Fatalf("a yes to an AI question is never chosen: %+v", result.Picks)
	}
}

func TestPicksStopAtTheRunsLimit(t *testing.T) {
	screen := &pickScreen{probs: map[string]map[string]float64{"q1": {"o0": 0.9, "o1": 0.05, "none": 0.05}}}
	cfg := DefaultConfig()
	cfg.MaxPicks = 1
	model := &scriptedModel{replies: []string{classified(), classified()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, cfg)
	started, _ := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", Prefill: true})
	req := PickRequest{Fields: []PickField{{Ref: 1, Kind: PickOne, Question: fmt.Sprint("Q"), Options: []string{"a", "b"}}}}
	if _, err := a.Pick(context.Background(), started.SessionID, req); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Pick(context.Background(), started.SessionID, req); err != ErrPickLimit {
		t.Fatalf("err = %v", err)
	}
}

func TestALongListKeepsItsOptionsUpToTheBound(t *testing.T) {
	var options []string
	for i := 0; i < 250; i++ {
		options = append(options, fmt.Sprintf("Country %d", i))
	}
	fields := validPickFields([]PickField{{Ref: 1, Kind: PickOne, Question: "Country", Options: options}})
	if len(fields) != 1 || len(fields[0].Options) != 250 {
		t.Fatalf("a list of 250 options is cut: %d", len(fields[0].Options))
	}
	many := make([]string, maxPickOptions+50)
	for i := range many {
		many[i] = fmt.Sprintf("Option %d", i)
	}
	fields = validPickFields([]PickField{{Ref: 1, Kind: PickOne, Question: "Q", Options: many}})
	if len(fields[0].Options) != maxPickOptions {
		t.Fatalf("the bound is %d, got %d", maxPickOptions, len(fields[0].Options))
	}
}
