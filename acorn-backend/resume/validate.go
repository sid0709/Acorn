package resume

import (
	"fmt"
	"strings"
)

// assertSections rejects a run that left Summary, Skills, or Experience empty, dropped a profile role,
// or gave a role no bullet. An empty employer heading is never a valid résumé.
func assertSections(sections map[string]any, careers []CareerEntry) error {
	if strings.TrimSpace(asString(asRecord(sections["summary"])["summary"])) == "" {
		return fmt.Errorf("Summary was empty.")
	}
	items := 0
	for _, group := range asList(asRecord(sections["skills"])["skills"]) {
		for _, item := range asList(asRecord(group)["items"]) {
			if asString(item) != "" {
				items++
			}
		}
	}
	if items == 0 {
		return fmt.Errorf("Skills was empty.")
	}
	rows := asList(asRecord(sections["experience"])["experiences"])
	if len(careers) > 0 && len(rows) != len(careers) {
		return fmt.Errorf("Experience is missing a profile role.")
	}
	if len(rows) == 0 {
		return fmt.Errorf("Experience was empty.")
	}
	var incomplete []string
	for _, item := range rows {
		row := asRecord(item)
		if asString(row["company"]) != "" && hasBullet(row) {
			continue
		}
		incomplete = append(incomplete, roleLabel(row))
	}
	if len(incomplete) > 0 {
		noun := "needs"
		if len(incomplete) > 1 {
			noun = "need"
		}
		return fmt.Errorf("Experience is incomplete: %s %s at least one bullet.", strings.Join(incomplete, "; "), noun)
	}
	return nil
}

func hasBullet(row map[string]any) bool {
	for _, bullet := range asList(row["bullets"]) {
		if asString(bullet) != "" {
			return true
		}
	}
	return false
}

func roleLabel(row map[string]any) string {
	title, company := asString(row["title"]), asString(row["company"])
	switch {
	case title != "" && company != "":
		return title + " at " + company
	case company != "":
		return company
	case title != "":
		return title
	}
	return "A profile role"
}
