package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeTrace writes a two-entry trace folder: a driving-model step with a check, and the done entry of a
// run that stopped before sending.
func writeTrace(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(name string, value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	started := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	write("session.json", map[string]any{
		"started": started, "model": "openai/gpt-6-luna",
		"start": map[string]any{"url": "https://jobs.example/apply", "stopBeforeSubmit": true},
	})
	write("001.json", map[string]any{
		"seq": 1, "step": 1, "at": started.Add(time.Second), "durationMs": 1500, "status": "working", "message": "Filling",
		"url": "https://jobs.example/apply", "actions": []map[string]any{{"kind": "click"}, {"kind": "type"}},
	})
	write("001.model.json", []map[string]any{
		{"kind": "", "usage": map[string]any{"inputTokens": 1000, "outputTokens": 50, "cachedTokens": 800, "cost": 0.01}, "latencyMs": 4000},
		{"kind": "decision", "usage": map[string]any{"inputTokens": 300, "cost": 0.001}, "latencyMs": 400},
	})
	write("002.json", map[string]any{
		"seq": 2, "step": 2, "at": started.Add(10 * time.Second), "durationMs": 900, "status": "done", "readyToSubmit": true,
		"message": "Ready to submit", "url": "https://jobs.example/review", "actions": []map[string]any{},
	})
	write("002.model.json", []map[string]any{
		{"kind": "", "usage": map[string]any{"inputTokens": 1200, "outputTokens": 40, "cachedTokens": 1100, "cost": 0.005}, "latencyMs": 3000},
	})
	return dir
}

func TestCollectReadsCostTimeAndHowTheRunEnded(t *testing.T) {
	dir := writeTrace(t)
	r, err := collect(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := r.summary
	if s.Entries != 2 || s.Actions != 2 || s.ModelCalls != 2 || s.Checks != 1 || s.InputTokens != 2200 || s.CachedTokens != 1900 || s.OutputTokens != 90 {
		t.Fatalf("counts: %+v", s)
	}
	if s.ModelCost != 0.015 || s.CheckCost != 0.001 || s.TotalCost != 0.016 {
		t.Fatalf("cost: %+v", s)
	}
	// The wall is from the first entry to the last, plus the last entry's model time.
	if s.WallMs != 12000 || s.ModelLatencyMs != 7000 || s.CheckLatencyMs != 400 {
		t.Fatalf("time: %+v", s)
	}
	if s.Status != "done" || !s.ReadyToSubmit || s.Message != "Ready to submit" || s.Stop != nil || s.LastURL != "https://jobs.example/review" {
		t.Fatalf("ending: %+v", s)
	}
	if s.URL != "https://jobs.example/apply" || !s.StopBeforeSubmit || s.Model != "openai/gpt-6-luna" || s.Session != filepath.Base(dir) {
		t.Fatalf("session: %+v", s)
	}
}

func TestCollectKeepsTheStopOfARunThatEndedForTheApplicant(t *testing.T) {
	dir := writeTrace(t)
	raw, _ := json.Marshal(map[string]any{
		"seq": 3, "step": 3, "at": time.Date(2026, 10, 21, 12, 0, 20, 0, time.UTC), "status": "stuck", "message": "This job is closed",
		"stop":    map[string]any{"reason": "job_unavailable", "kind": "expired", "problem": "The posting says it is filled.", "action": "Try another job."},
		"actions": []map[string]any{},
	})
	if err := os.WriteFile(filepath.Join(dir, "003.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := collect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if r.summary.Status != "stuck" || r.summary.Stop == nil || r.summary.Stop.Reason != "job_unavailable" || r.summary.Stop.Kind != "expired" || r.summary.ReadyToSubmit {
		t.Fatalf("ending: %+v stop %+v", r.summary, r.summary.Stop)
	}
}

func TestCollectRefusesAFolderWithNoSteps(t *testing.T) {
	if _, err := collect(t.TempDir()); err == nil {
		t.Fatal("an empty folder is not a run")
	}
}
