package resume

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// identityKey folds a company or date into a comparable key.
func identityKey(value string) string {
	folded := strings.ToLower(norm.NFKC.String(strings.TrimSpace(value)))
	return strings.Join(strings.FieldsFunc(folded, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	}), " ")
}

// matchExperienceRows pairs each profile role with the model row that belongs to it: exact company,
// then a close spelling or shortened name, then position when the model used no recognizable company
// names. A role with no row gets an empty one.
func matchExperienceRows(careers []CareerEntry, rows []map[string]any) []map[string]any {
	unused := map[int]bool{}
	for i := range rows {
		unused[i] = true
	}
	recognizable := false
	for _, row := range rows {
		for _, career := range careers {
			if companiesAlign(identityKey(career.Company), identityKey(asString(row["company"]))) {
				recognizable = true
			}
		}
	}
	out := make([]map[string]any, len(careers))
	for i, career := range careers {
		out[i] = map[string]any{}
		index, ok := pickRow(career, i, len(careers), rows, unused, recognizable)
		if !ok {
			continue
		}
		delete(unused, index)
		out[i] = rows[index]
	}
	return out
}

func pickRow(career CareerEntry, careerIndex, careerCount int, rows []map[string]any, unused map[int]bool, recognizable bool) (int, bool) {
	company := identityKey(career.Company)
	period := identityKey(career.Period)
	candidates := func(match func(index int) bool) []int {
		var found []int
		for i := range rows {
			if unused[i] && match(i) {
				found = append(found, i)
			}
		}
		return found
	}
	prefer := func(indexes []int) int {
		for _, index := range indexes {
			if period != "" && identityKey(asString(rows[index]["period"])) == period {
				return index
			}
		}
		return indexes[0]
	}
	if exact := candidates(func(i int) bool { return company != "" && identityKey(asString(rows[i]["company"])) == company }); len(exact) > 0 {
		return prefer(exact), true
	}
	if close := candidates(func(i int) bool { return companiesAlign(company, identityKey(asString(rows[i]["company"]))) }); len(close) > 0 {
		return prefer(close), true
	}
	if !recognizable && len(rows) == careerCount && unused[careerIndex] {
		return careerIndex, true
	}
	return 0, false
}

func companiesAlign(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	if left == right {
		return true
	}
	if editSimilarity(left, right) >= 0.84 {
		return true
	}
	shorter, longer := left, right
	if len(shorter) > len(longer) {
		shorter, longer = longer, shorter
	}
	return len(shorter) >= 8 && strings.HasPrefix(longer, shorter+" ")
}

func editSimilarity(left, right string) float64 {
	l, r := []rune(left), []rune(right)
	longest := len(l)
	if len(r) > longest {
		longest = len(r)
	}
	return 1 - float64(editDistance(l, r))/float64(longest)
}

func editDistance(left, right []rune) int {
	if len(left) == 0 {
		return len(right)
	}
	if len(right) == 0 {
		return len(left)
	}
	prev := make([]int, len(right)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(left); i++ {
		cur := make([]int, len(right)+1)
		cur[0] = i
		for j := 1; j <= len(right); j++ {
			cost := 1
			if left[i-1] == right[j-1] {
				cost = 0
			}
			cur[j] = min(cur[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(right)]
}
