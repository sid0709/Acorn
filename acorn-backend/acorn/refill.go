package acorn

import (
	"context"
	"fmt"
	"strings"
)

// ModeRefill is the extension's Refill: fix only the fields the page flagged
// after Submit / Next. Any other mode plans a full fill.
const ModeRefill = "refill"

// FieldIssue is one control the live page flags, as @acorn/shared/field-issues sends it.
type FieldIssue struct {
	ElementIndex   int      `json:"elementIndex"`
	Label          string   `json:"label"`
	Role           string   `json:"role"`
	Value          string   `json:"value"`
	Required       bool     `json:"required"`
	Invalid        bool     `json:"invalid"`
	LinkedMessages []string `json:"linkedMessages"`
	NearbyMessages []string `json:"nearbyMessages"`
}

// FieldIssueScan is every flagged field plus page-level alerts.
type FieldIssueScan struct {
	Issues       []FieldIssue `json:"issues"`
	PageMessages []string     `json:"pageMessages"`
}

// Refill plans fixes for the flagged fields only: clear rejected filler, refill
// rejected or missing answers, then let the writer rewrite typed answers with
// the page's error in view. history is the plans already run on this page,
// oldest first: the planner continues that conversation instead of starting over.
func (s *Service) Refill(ctx context.Context, applicant, pureTree string, scan FieldIssueScan, page map[string]any, history []PlanTurn) (AnalyzeResult, error) {
	if strings.TrimSpace(pureTree) == "" {
		return AnalyzeResult{}, fmt.Errorf("%w: pureTree is required", ErrInvalid)
	}
	if len(scan.Issues) == 0 {
		return AnalyzeResult{}, fmt.Errorf("%w: fieldIssues are required for refill", ErrInvalid)
	}
	if err := validateHistory(history); err != nil {
		return AnalyzeResult{}, err
	}
	page = withResumeAvailable(page)

	turns := refillTurns(history, refillUserPrompt(applicant, pureTree, scan, page))
	text, err := s.askTurns(ctx, PurposeRefill, refillSystem, turns, refillPlanSchema())
	if err != nil {
		return AnalyzeResult{}, err
	}
	var plan Plan
	if err := decodeModelJSON(text, &plan); err != nil {
		return AnalyzeResult{}, err
	}
	if err := validatePlan(plan); err != nil {
		return AnalyzeResult{}, err
	}

	plan = s.fillPasswords(s.finishPlan(ctx, plan, applicant, page, issueNotes(scan)), passwordIssues(scan))
	return AnalyzeResult{OK: true, Plan: plan, Model: s.model.Model(), Mode: ModeRefill}, nil
}

// passwordIssues are the flagged fields the page reports as password boxes.
func passwordIssues(scan FieldIssueScan) map[int]bool {
	passwords := map[int]bool{}
	for _, issue := range scan.Issues {
		if roleToken(issue.Role) == rolePassword {
			passwords[issue.ElementIndex] = true
		}
	}
	return passwords
}

// issueNotes is each flagged field's page text, so a rewritten answer still satisfies it.
func issueNotes(scan FieldIssueScan) map[int]string {
	notes := map[int]string{}
	for _, issue := range scan.Issues {
		messages := append(append([]string{}, issue.LinkedMessages...), issue.NearbyMessages...)
		if len(messages) > 0 {
			notes[issue.ElementIndex] = strings.Join(messages, " | ")
		}
	}
	return notes
}

// refillUserPrompt keeps the cacheable prefix first (see analyzeUserPrompt).
func refillUserPrompt(applicant, pureTree string, scan FieldIssueScan, page map[string]any) string {
	alerts := ""
	if len(scan.PageMessages) > 0 {
		alerts = "Page messages:\n" + indentedJSON(scan.PageMessages) + "\n\n"
	}
	return strings.TrimSpace("Applicant data:\n" + applicant + "\n\nPure Tree:\n" + pureTree + "\n\n" +
		"Flagged fields:\n" + indentedJSON(scan.Issues) + "\n\n" + alerts + pageBlock(page))
}
