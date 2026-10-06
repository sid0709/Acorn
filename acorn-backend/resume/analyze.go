package resume

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	analyzeTextMaxRunes = 12000
	skillLevelMin       = 2
	skillLevelMax       = 5
	skillTotalLimit     = 28
)

var skillCategoryOrder = []string{"hard", "devops", "tools", "domain", "soft"}

var skillCategoryLimit = map[string]int{
	"hard":   10,
	"devops": 6,
	"tools":  6,
	"domain": 5,
	"soft":   4,
}

const skillAnalysisSystem = `You are an expert technical recruiter analyzing a candidate resume.

Extract a curated shortlist of skills that truly define this candidate. For each skill assign a category and proficiency level (1–5).

Your output must be small enough to plot every skill on a radar chart per category — quality over quantity.

Categories (choose exactly one per skill):
- hard — languages, frameworks, libraries, databases (e.g. C#, .NET, Vue.js, PostgreSQL).
- devops — cloud, infra, CI/CD, containers, observability (e.g. Azure, Docker, Kubernetes).
- tools — platforms, testing tools, methodologies (e.g. Cypress, REST APIs, Agile).
- domain — industry / business / architecture knowledge (e.g. Fintech, Microservices).
- soft — interpersonal skills (e.g. Mentoring, Communication, Leadership).

Proficiency level (1–5):
- 5 — defining skill: summary + repeated senior use across roles
- 4 — core day-to-day with strong bullet evidence
- 3 — clearly used in at least one role or prominent in Skills section
- 2 — secondary; omit unless it helps fill a sparse category
- 1 — omit (do not output level 1)

Strict output limits (do not exceed):
- hard 10, devops 6, tools 6, domain 5, soft 4
- Total: 15–25 skills. If the resume lists 50+ technologies, pick only what recruiters would care about for matching.

Selection rules:
1. Consolidate duplicates — one entry per technology (Vue 3 + Vue.js → Vue.js; .NET 6 + .NET 8 → .NET).
2. Prioritize evidence — summary, job titles, and repeated bullets beat a long Skills-section dump.
3. Skip filler — generic patterns, minor libraries, and buzzwords with no substance.
4. Include the primary stack at level 4–5.
5. Include soft skills only when clearly evidenced (max 3–4).
6. Never invent skills absent from the resume.
7. Never include job titles, employers, dates, or section labels.

Output ONLY valid JSON: { "skills": [ { "name": "C#", "category": "hard", "level": 5 } ] }
Sort by level descending, then name. level is an integer 2–5. category is one of: hard, devops, tools, domain, soft.`

const skillAnalysisSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "name": { "type": "string" },
          "category": { "type": "string", "enum": ["hard", "devops", "tools", "domain", "soft"] },
          "level": { "type": "integer", "minimum": 2, "maximum": 5 }
        },
        "required": ["name", "category", "level"]
      }
    }
  },
  "required": ["skills"]
}`

func (s *Service) AnalyzeLibrary(ctx context.Context, accountID, id string, force bool) (LibraryRow, error) {
	row, ok := s.store.libraryItem(accountID, id)
	if !ok {
		return LibraryRow{}, ErrNotFound
	}
	if row.Analyzed && !force && len(row.SkillProfile) > 0 {
		row.Bytes = nil
		return row, nil
	}
	if strings.TrimSpace(row.ExtractedText) == "" {
		row.ExtractedText = extractFileText(row.FileName, row.Bytes)
	}
	text := truncateRunes(strings.TrimSpace(row.ExtractedText), analyzeTextMaxRunes)
	if text == "" {
		return LibraryRow{}, fmt.Errorf("%w: no extracted text available for analysis", ErrInvalid)
	}
	if s.model == nil || !s.model.Ready() {
		return LibraryRow{}, ErrUnavailable
	}
	payload, err := json.Marshal(map[string]string{
		"fileName":   row.FileName,
		"title":      row.Title,
		"resumeText": text,
	})
	if err != nil {
		return LibraryRow{}, err
	}
	raw, err := s.model.JSON(ctx, skillAnalysisSystem, string(payload), json.RawMessage(skillAnalysisSchema))
	if err != nil {
		return LibraryRow{}, fmt.Errorf("analyze résumé: %w", err)
	}
	skills := capSkillProfile(parseSkillProfile(raw))
	if len(skills) == 0 {
		return LibraryRow{}, fmt.Errorf("%w: model returned no skills", ErrInvalid)
	}
	now := time.Now().UTC()
	row.SkillProfile = skills
	row.Skills = skillNames(skills)
	row.Analyzed = true
	row.AnalyzedAt = &now
	if err := s.store.putLibrary(row); err != nil {
		return LibraryRow{}, err
	}
	row.Bytes = nil
	return row, nil
}

func skillNames(skills []SkillEntry) []string {
	names := make([]string, 0, len(skills))
	for _, skill := range skills {
		names = append(names, skill.Name)
	}
	return names
}

func parseSkillProfile(raw []byte) []SkillEntry {
	parsed := unmarshalSkillJSON(raw)
	if parsed == nil {
		return nil
	}
	var items []any
	switch body := parsed.(type) {
	case []any:
		items = body
	case map[string]any:
		list, _ := body["skills"].([]any)
		items = list
	default:
		return nil
	}
	out := make([]SkillEntry, 0, len(items))
	for _, item := range items {
		entry, ok := normalizeSkill(item)
		if ok {
			out = append(out, entry)
		}
	}
	return out
}

func unmarshalSkillJSON(raw []byte) any {
	var parsed any
	if json.Unmarshal(raw, &parsed) == nil {
		return parsed
	}
	text := strings.TrimSpace(string(raw))
	objectAt := strings.Index(text, "{")
	arrayAt := strings.Index(text, "[")
	from := objectAt
	endChar := "}"
	if arrayAt >= 0 && (objectAt < 0 || arrayAt < objectAt) {
		from = arrayAt
		endChar = "]"
	}
	if from < 0 {
		return nil
	}
	end := strings.LastIndex(text, endChar)
	if end <= from {
		return nil
	}
	if json.Unmarshal([]byte(text[from:end+1]), &parsed) != nil {
		return nil
	}
	return parsed
}

func normalizeSkill(item any) (SkillEntry, bool) {
	record, ok := item.(map[string]any)
	if !ok {
		return SkillEntry{}, false
	}
	name := strings.TrimSpace(stringField(record, "name"))
	if name == "" {
		name = strings.TrimSpace(stringField(record, "skill"))
	}
	if name == "" {
		return SkillEntry{}, false
	}
	level := intField(record["level"])
	if level == 0 {
		level = intField(record["strength"])
	}
	if level < skillLevelMin || level > skillLevelMax {
		return SkillEntry{}, false
	}
	return SkillEntry{Name: name, Category: normalizeCategory(stringField(record, "category")), Level: level}, true
}

func stringField(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func intField(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func normalizeCategory(raw string) string {
	category := strings.ToLower(strings.TrimSpace(raw))
	if _, ok := skillCategoryLimit[category]; ok {
		return category
	}
	return "hard"
}

func capSkillProfile(skills []SkillEntry) []SkillEntry {
	best := map[string]SkillEntry{}
	for _, skill := range skills {
		key := strings.ToLower(skill.Name)
		prev, ok := best[key]
		if !ok || skill.Level > prev.Level {
			best[key] = skill
		}
	}
	deduped := make([]SkillEntry, 0, len(best))
	for _, skill := range best {
		deduped = append(deduped, skill)
	}
	sort.Slice(deduped, func(i, j int) bool {
		if deduped[i].Level != deduped[j].Level {
			return deduped[i].Level > deduped[j].Level
		}
		return deduped[i].Name < deduped[j].Name
	})
	grouped := map[string][]SkillEntry{}
	for _, category := range skillCategoryOrder {
		grouped[category] = nil
	}
	for _, skill := range deduped {
		grouped[skill.Category] = append(grouped[skill.Category], skill)
	}
	capped := make([]SkillEntry, 0, skillTotalLimit)
	for _, category := range skillCategoryOrder {
		list := grouped[category]
		limit := skillCategoryLimit[category]
		if len(list) > limit {
			list = list[:limit]
		}
		capped = append(capped, list...)
	}
	sort.Slice(capped, func(i, j int) bool {
		if capped[i].Level != capped[j].Level {
			return capped[i].Level > capped[j].Level
		}
		return capped[i].Name < capped[j].Name
	})
	if len(capped) > skillTotalLimit {
		capped = capped[:skillTotalLimit]
	}
	return capped
}

func truncateRunes(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	count := 0
	for index := range value {
		if count == max {
			return value[:index]
		}
		count++
	}
	return value
}
