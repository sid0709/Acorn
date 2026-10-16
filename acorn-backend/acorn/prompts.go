// Package acorn writes the answers to free-text questions the Acorn extension asks, from the
// signed-in job hunter's Acorn profile.
package acorn

import "embed"

//go:embed prompts/*.txt
var promptFiles embed.FS

func prompt(name string) string {
	data, err := promptFiles.ReadFile("prompts/" + name + ".txt")
	if err != nil {
		panic("acorn: missing prompt " + name)
	}
	return string(data)
}

var proseSystem = prompt("prose_system")
