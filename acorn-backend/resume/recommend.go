package resume

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

// maxCandidateSkills is how many analyzed skills describe one Library résumé to the selector.
const maxCandidateSkills = 20

// ErrNoPosting means the text Recommend was given is not a job posting.
var ErrNoPosting = errors.New("No job description on this page")

// PostingMatcher decides whether text is a job posting and which candidate fits it.
// *selector.Gateway (TypeSafe Jev) is the real one.
type PostingMatcher interface {
	MatchPosting(ctx context.Context, posting string, candidates []selector.Candidate) (selector.PostingMatch, error)
}

// Recommend picks the uploaded Library résumé for a posting and remembers it for
// jobID. The matcher first confirms the text is a posting, then chooses among the
// account's uploads by stack title and analyzed skills.
func (s *Service) Recommend(ctx context.Context, accountID, posting, jobID string, matcher PostingMatcher) (id, stack, reason string, err error) {
	if strings.TrimSpace(posting) == "" {
		return "", "", "", fmt.Errorf("%w: job description is required", ErrInvalid)
	}
	rows := uploadedLibrary(s.store.listLibrary(accountID))
	if len(rows) == 0 {
		return "", "", "", ErrNoLibrary
	}
	candidates := make([]selector.Candidate, len(rows))
	for i, row := range rows {
		candidates[i] = selector.Candidate{ID: row.ID, Description: describeLibraryRow(row)}
	}
	match, err := matcher.MatchPosting(ctx, posting, candidates)
	if err != nil {
		return "", "", "", fmt.Errorf("recommend: %w", err)
	}
	if !match.IsPosting {
		return "", "", "", ErrNoPosting
	}
	if match.ID == "" {
		return "", "", "", ErrNoLibrary
	}
	for _, row := range rows {
		if row.ID != match.ID {
			continue
		}
		reason = fmt.Sprintf("Matched the posting to the %s library résumé (%.0f%% sure).", row.Title, match.Confidence*100)
		if jobID != "" {
			s.store.rememberJob(accountID, jobID, row.ID)
		}
		return row.ID, row.Title, reason, nil
	}
	return "", "", "", ErrNoLibrary
}

func uploadedLibrary(rows []LibraryRow) []LibraryRow {
	out := make([]LibraryRow, 0, len(rows))
	for _, row := range rows {
		if row.Source == "" || row.Source == "uploaded" {
			out = append(out, row)
		}
	}
	return out
}

// describeLibraryRow is what the selector reads about one résumé: the stack title
// (its Library folder) and the strongest analyzed skills.
func describeLibraryRow(row LibraryRow) string {
	parts := []string{"Stack: " + strings.TrimSpace(row.Title)}
	if skills := strongestSkills(row); len(skills) > 0 {
		parts = append(parts, "Skills: "+strings.Join(skills, ", "))
	}
	if row.IsPrimary {
		parts = append(parts, "The applicant's primary résumé.")
	}
	return strings.Join(parts, ". ")
}

func strongestSkills(row LibraryRow) []string {
	profile := append([]SkillEntry{}, row.SkillProfile...)
	sort.SliceStable(profile, func(i, j int) bool { return profile[i].Level > profile[j].Level })
	names := make([]string, 0, maxCandidateSkills)
	for _, skill := range profile {
		if name := strings.TrimSpace(skill.Name); name != "" {
			names = append(names, name)
		}
		if len(names) == maxCandidateSkills {
			return names
		}
	}
	if len(names) > 0 {
		return names
	}
	if len(row.Skills) > maxCandidateSkills {
		return row.Skills[:maxCandidateSkills]
	}
	return row.Skills
}
