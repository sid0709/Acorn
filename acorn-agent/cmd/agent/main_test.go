package main

import (
	"strings"
	"testing"
)

func TestASwitchIsOnWhenSetToAnythingButAnOffWord(t *testing.T) {
	for value, want := range map[string]bool{"": false, "  ": false, "on": true, "true": true, "1": true, "yes": true, "ON": true, "off": false, "false": false, "0": false, "no": false, " off ": false} {
		if got := isOn(value); got != want {
			t.Errorf("isOn(%q) = %v, want %v", value, got, want)
		}
	}
}

func TestASwitchReadFromTheEnvironmentFallsBackWhenUnset(t *testing.T) {
	const name = "ACORN_AGENT_TEST_SWITCH"
	for value, want := range map[string]bool{"": true, "on": true, "off": false, "0": false, "true": true} {
		t.Setenv(name, value)
		if got := envSwitch(name, true); got != want {
			t.Errorf("envSwitch(%q, true) = %v, want %v", value, got, want)
		}
	}
	t.Setenv(envStopBeforeSubmit, "")
	if envSwitch(envStopBeforeSubmit, defaultStopBeforeSubmit) {
		t.Fatal("stop before submit must be off unless the environment turns it on")
	}
	t.Setenv(envStopBeforeSubmit, "true")
	if !envSwitch(envStopBeforeSubmit, defaultStopBeforeSubmit) {
		t.Fatal("ACORN_AGENT_STOP_BEFORE_SUBMIT=true must turn it on")
	}
}

func TestTheOpeningLineSaysWhenEveryRunStopsBeforeSending(t *testing.T) {
	line := listeningStory("127.0.0.1:1", "m", "s", true, "files", "data", true, "", true)
	if !strings.Contains(line, "Every run stops before the application is sent.") {
		t.Fatalf("line = %q", line)
	}
	if plain := listeningStory("127.0.0.1:1", "m", "s", true, "files", "data", true, "", false); strings.Contains(plain, "stops before") {
		t.Fatalf("line = %q", plain)
	}
}
