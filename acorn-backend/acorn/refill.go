package acorn

import (
	"context"
	"encoding/json"
	"errors"
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
// the page's error in view.
func (s *Service) Refill(ctx context.Context, applicant, pureTree string, scan FieldIssueScan, page map[string]any) (AnalyzeResult, error) {
	if strings.TrimSpace(pureTree) == "" {
		return AnalyzeResult{}, fmt.Errorf("%w: pureTree is required", ErrInvalid)
	}
	if len(scan.Issues) == 0 {
		return AnalyzeResult{}, fmt.Errorf("%w: fieldIssues are required for refill", ErrInvalid)
	}
	page = withResumeAvailable(page)

	text, err := s.ask(ctx, PurposeRefill, refillSystem, refillUserPrompt(applicant, pureTree, scan, page), refillPlanSchema())
	if err != nil {
		return AnalyzeResult{}, err
	}
	var plan Plan
	if err := json.Unmarshal([]byte(text), &plan); err != nil {
		return AnalyzeResult{}, errors.New("model returned non-JSON output")
	}
	if err := validatePlan(plan); err != nil {
		return AnalyzeResult{}, err
	}

	identity := s.classifyIdentity(ctx, plan)
	plan = applyApplicantIdentity(plan, identity)
	plan = s.rewriteTyping(ctx, plan, applicant, page, issueNotes(scan))
	plan = applyApplicantIdentity(plan, identity)
	return AnalyzeResult{OK: true, Plan: plan, Model: s.model.Model(), Mode: ModeRefill}, nil
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

func refillUserPrompt(applicant, pureTree string, scan FieldIssueScan, page map[string]any) string {
	pageBlock := ""
	if len(page) > 0 {
		pageBlock = "Page:\n" + indentedJSON(page) + "\n\n"
	}
	alerts := ""
	if len(scan.PageMessages) > 0 {
		alerts = "Page messages:\n" + indentedJSON(scan.PageMessages) + "\n\n"
	}
	return strings.TrimSpace(pageBlock + "Applicant data:\n" + applicant + "\n\n" +
		"Flagged fields:\n" + indentedJSON(scan.Issues) + "\n\n" + alerts +
		"Pure Tree:\n" + pureTree)
}
