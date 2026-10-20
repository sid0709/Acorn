package main

import "testing"

func TestASwitchIsOnWhenSetToAnythingButAnOffWord(t *testing.T) {
	for value, want := range map[string]bool{"": false, "  ": false, "on": true, "true": true, "1": true, "yes": true, "ON": true, "off": false, "false": false, "0": false, "no": false, " off ": false} {
		if got := isOn(value); got != want {
			t.Errorf("isOn(%q) = %v, want %v", value, got, want)
		}
	}
}
