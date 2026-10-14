package resume

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

const (
	// maxCandidateSkills is how many analyzed skills describe one Library résumé to the selector.
	maxCandidateSkills = 20
	// RecommendTopCount is how many ranked résumés Recommend returns.
	RecommendTopCount = 3
)

// ErrNoPosting means the text Recommend was given is not a job posting.
var ErrNoPosting = errors.New("No job description on this page")

// PostingMatcher decides whether text is a job posting and which candidate fits it.
// *selector.Gateway (TypeSafe Jev) is the real one.
type PostingMatcher interface {
	MatchPosting(ctx context.Context, posting string, candidates []selector.Candidate) (selector.PostingMatch, error)
}

// Recommendation is the Library résumé to send and the closest alternatives.
type Recommendation struct {
	ResumeID string
	Stack    string
	Reason   string
	// Top is the best-ranked résumés, most probable first; Top[0] is the pick.
	Top []RankedResume
	// Timings is how long each stage took, in milliseconds, so a slow recommend
	// can be told apart: loading the Library rows, or the match.
	Timings map[string]int64
}

// RankedResume is one Library résumé and the selector's probability that it fits.
type RankedResume struct {
	ResumeID    string  `json:"resumeId"`
	Stack       string  `json:"stack"`
	Probability float64 `json:"probability"`
}

// Recommend picks the uploaded Library résumé for a posting and remembers it for
// jobID. The matcher confirms the text is a posting, then ranks every upload by
// stack title and analyzed skills; the most probable one is recommended.
func (s *Service) Recommend(ctx context.Context, accountID, posting, jobID string, matcher PostingMatcher) (Recommendation, error) {
	if strings.TrimSpace(posting) == "" {
		return Recommendation{}, fmt.Errorf("%w: job description is required", ErrInvalid)
	}
	timings := map[string]int64{}
	stage := time.Now()
	// One candidate per stack: its PDF and Word files are the same résumé.
	candidateRows := s.store.libraryCandidates(accountID)
	timings["candidates"] = time.Since(stage).Milliseconds()
	stacks := stacksOf(candidateRows, KindResume)
	if len(stacks) == 0 {
		return Recommendation{}, ErrNoLibrary
	}
	rows := make([]LibraryRow, len(stacks))
	for i, stack := range stacks {
		rows[i] = stack.Lead()
		rows[i].IsPrimary = stack.IsPrimary()
	}
	byID := make(map[string]LibraryRow, len(rows))
	candidates := make([]selector.Candidate, len(rows))
	for i, row := range rows {
		byID[row.ID] = row
		candidates[i] = selector.Candidate{ID: row.ID, Description: describeLibraryRow(row)}
	}
	stage = time.Now()
	match, err := matcher.MatchPosting(ctx, posting, candidates)
	timings["match"] = time.Since(stage).Milliseconds()
	if err != nil {
		return Recommendation{}, fmt.Errorf("recommend: %w", err)
	}
	if !match.IsPosting {
		return Recommendation{}, ErrNoPosting
	}
	top := make([]RankedResume, 0, RecommendTopCount)
	for _, ranked := range match.Ranked {
		if row, ok := byID[ranked.ID]; ok {
			top = append(top, RankedResume{ResumeID: row.ID, Stack: row.Title, Probability: ranked.Probability})
		}
		if len(top) == RecommendTopCount {
			break
		}
	}
	if len(top) == 0 {
		return Recommendation{}, ErrNoLibrary
	}
	best := top[0]
	if jobID != "" {
		s.store.rememberJob(accountID, jobID, best.ResumeID)
	}
	s.warmFiles(accountID, byID[best.ResumeID])
	return Recommendation{
		ResumeID: best.ResumeID,
		Stack:    best.Stack,
		Reason:   fmt.Sprintf("Best match of %d Library résumés: %s (%.0f%%).", len(rows), best.Stack, best.Probability*100),
		Top:      top,
		Timings:  timings,
	}, nil
}

func uploadedLibrary(rows []LibraryRow) []LibraryRow {
	out := make([]LibraryRow, 0, len(rows))
	for _, row := range rows {
		if isUploaded(row) {
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

// ErrNoCoverLetter means the account keeps no cover letter in its Library.
var ErrNoCoverLetter = errors.New("no cover letter in the Library")

// CoverLetterPick is the cover letter to attach, with every format of its stack.
type CoverLetterPick struct {
	File   FilePayload
	Stack  string
	Reason string
}

// CoverLetterChoice is the cover letter picked, before its file is read: a client
// that keeps files itself asks for the file by this id.
type CoverLetterChoice struct {
	ResumeID string
	Stack    string
	Reason   string
}

// CoverLetter picks the Library cover letter for a posting. One stack is used as
// it is, with no model call; several are ranked against the posting by their
// stack title and analyzed skills, as résumés are. With no posting to read, the
// primary (else the first) stack is used.
func (s *Service) CoverLetter(ctx context.Context, accountID, posting string, matcher PostingMatcher) (CoverLetterPick, error) {
	choice, err := s.CoverLetterID(ctx, accountID, posting, matcher)
	if err != nil {
		return CoverLetterPick{}, err
	}
	file, err := s.LibraryFile(accountID, choice.ResumeID)
	if err != nil {
		return CoverLetterPick{}, err
	}
	return CoverLetterPick{File: file, Stack: choice.Stack, Reason: choice.Reason}, nil
}

// CoverLetterID is CoverLetter without reading the file.
func (s *Service) CoverLetterID(ctx context.Context, accountID, posting string, matcher PostingMatcher) (CoverLetterChoice, error) {
	stacks := stacksOf(s.store.libraryCandidates(accountID), KindCoverLetter)
	if len(stacks) == 0 {
		return CoverLetterChoice{}, ErrNoCoverLetter
	}
	chosen := fallbackStack(stacks)
	reason := "Your only cover letter."
	if len(stacks) > 1 {
		reason = "Your primary cover letter."
		if ranked, ok := s.rankCoverLetters(ctx, posting, stacks, matcher); ok {
			chosen, reason = ranked.stack, ranked.reason
		}
	}
	return CoverLetterChoice{ResumeID: chosen.Lead().ID, Stack: chosen.Title, Reason: reason}, nil
}

// fallbackStack is the primary stack, else the first.
func fallbackStack(stacks []LibraryStack) LibraryStack {
	for _, stack := range stacks {
		if stack.IsPrimary() {
			return stack
		}
	}
	return stacks[0]
}

type rankedStack struct {
	stack  LibraryStack
	reason string
}

// rankCoverLetters has the matcher pick the cover letter that fits the posting;
// false when there is no posting to read or the matcher could not answer.
func (s *Service) rankCoverLetters(ctx context.Context, posting string, stacks []LibraryStack, matcher PostingMatcher) (rankedStack, bool) {
	if strings.TrimSpace(posting) == "" || matcher == nil {
		return rankedStack{}, false
	}
	byID := make(map[string]LibraryStack, len(stacks))
	candidates := make([]selector.Candidate, len(stacks))
	for i, stack := range stacks {
		lead := stack.Lead()
		lead.IsPrimary = stack.IsPrimary()
		byID[lead.ID] = stack
		candidates[i] = selector.Candidate{ID: lead.ID, Description: describeLibraryRow(lead)}
	}
	match, err := matcher.MatchPosting(ctx, posting, candidates)
	if err != nil || len(match.Ranked) == 0 {
		return rankedStack{}, false
	}
	best := match.Ranked[0]
	stack, ok := byID[best.ID]
	if !ok {
		return rankedStack{}, false
	}
	return rankedStack{
		stack:  stack,
		reason: fmt.Sprintf("Best match of %d cover letters: %s (%.0f%%).", len(stacks), stack.Title, best.Probability*100),
	}, true
}

// warmCoverLetterStacks is how many cover-letter stacks are read ahead.
const warmCoverLetterStacks = 3

// warmFiles reads the files a run is about to attach into memory: the recommended
// résumé's stack and the account's cover letters. It runs beside the request, so
// the request that asks for a file finds it loaded or joins the read in flight.
func (s *Service) warmFiles(accountID string, lead LibraryRow) {
	go s.stackWithVersion(accountID, lead)
	for i, stack := range stacksOf(s.store.libraryCandidates(accountID), KindCoverLetter) {
		if i == warmCoverLetterStacks {
			break
		}
		go s.stackWithVersion(accountID, stack.Lead())
	}
}
