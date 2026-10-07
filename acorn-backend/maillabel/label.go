// Package maillabel files one page of Gmail with TypeSafe Jev.
// Decisions run in parallel batches. Each batch applies its labels as soon as
// Jev answers, so labeling does not wait for the rest of the page.
package maillabel

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/sid0709/OpenSeat/backend-core/jev"
	"golang.org/x/sync/errgroup"
)

const (
	// BatchSize is how many emails share one Jev call.
	BatchSize = 16
	// BatchConcurrency is how many of those calls run at once.
	BatchConcurrency = 8
	// ModifyConcurrency is how many Gmail label writes run at once per batch.
	ModifyConcurrency = 10
	// MaxMessages is one page. Autolabel never walks the whole mailbox.
	MaxMessages = 100

	noneKey         = "none"
	noneDescription = "No label fits this email."
	labelState      = "Emails in one Gmail inbox."
	maxFrom         = 200
	maxSubject      = 300
	maxSnippet      = 500
)

var (
	// ErrNoGuides means no label has a description yet.
	ErrNoGuides = errors.New("add a description for at least one label")
	// ErrNoMail means the page had nothing selected.
	ErrNoMail = errors.New("select mail to label")
	// ErrTooMany means the request tried to label more than one page.
	ErrTooMany = errors.New("label one page at a time")
)

// Decider is the decision model. *jev.Client is the real one.
type Decider interface {
	Decide(ctx context.Context, req jev.Request) (jev.Response, error)
}

// Applier writes one label onto one message.
type Applier interface {
	AddLabel(ctx context.Context, messageID, labelID string) error
}

// Guide is one custom label and when it applies.
type Guide struct {
	LabelID     string
	Description string
}

// Mail is the text Jev reads. The body is the list snippet, not the full message.
type Mail struct {
	ID      string
	From    string
	Subject string
	Snippet string
}

// Result is what happened to one message.
type Result struct {
	MessageID string
	LabelID   string
	Applied   bool
	Failed    bool
}

// Summary is one page of labeling.
type Summary struct {
	Results   []Result
	Labeled   int
	Unmatched int
	Failed    int
}

type indexed struct {
	index int
	mail  Mail
}

// Run asks Jev which saved label fits each message, then applies that label.
func Run(ctx context.Context, decider Decider, apply Applier, guides []Guide, mail []Mail) (Summary, error) {
	criteria := criteriaOf(guides)
	if len(criteria) <= 1 {
		return Summary{}, ErrNoGuides
	}
	mail = dedupe(mail)
	if len(mail) == 0 {
		return Summary{}, ErrNoMail
	}
	if len(mail) > MaxMessages {
		return Summary{}, ErrTooMany
	}

	results := make([]Result, len(mail))
	for i, item := range mail {
		results[i] = Result{MessageID: item.ID}
	}
	var mu sync.Mutex
	record := func(index int, result Result) {
		mu.Lock()
		results[index] = result
		mu.Unlock()
	}
	items := make([]indexed, len(mail))
	for i, item := range mail {
		items[i] = indexed{index: i, mail: item}
	}

	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(BatchConcurrency)
	for start := 0; start < len(items); start += BatchSize {
		batch := items[start:min(start+BatchSize, len(items))]
		group.Go(func() error {
			choices, err := decide(groupCtx, decider, criteria, batch)
			if err != nil {
				return err
			}
			writes, writeCtx := errgroup.WithContext(groupCtx)
			writes.SetLimit(ModifyConcurrency)
			for _, item := range batch {
				labelID := choices[item.mail.ID]
				if labelID == "" {
					continue
				}
				writes.Go(func() error {
					err := apply.AddLabel(writeCtx, item.mail.ID, labelID)
					if err != nil {
						record(item.index, Result{MessageID: item.mail.ID, LabelID: labelID, Failed: true})
						if stops(err) {
							return err
						}
						return nil
					}
					record(item.index, Result{MessageID: item.mail.ID, LabelID: labelID, Applied: true})
					return nil
				})
			}
			return writes.Wait()
		})
	}
	err := group.Wait()
	summary := Summary{Results: results}
	for _, result := range results {
		switch {
		case result.Applied:
			summary.Labeled++
		case result.Failed:
			summary.Failed++
		default:
			summary.Unmatched++
		}
	}
	if err != nil && summary.Labeled == 0 && summary.Failed == 0 {
		return Summary{}, err
	}
	return summary, err
}

// labelingStop is an apply error that should halt the rest of the page.
type labelingStop interface {
	StopLabeling()
}

func stops(err error) bool {
	var stop labelingStop
	return errors.As(err, &stop)
}

func decide(ctx context.Context, decider Decider, criteria map[string]string, batch []indexed) (map[string]string, error) {
	questions := make(map[string]jev.Question, len(batch))
	for _, item := range batch {
		questions[item.mail.ID] = jev.Question{
			Type:         jev.TypeChoice,
			Instructions: mailText(item.mail),
			Criteria:     criteria,
		}
	}
	res, err := decider.Decide(ctx, jev.Request{State: labelState, Questions: questions})
	if err != nil {
		return nil, fmt.Errorf("label mail: %w", err)
	}
	choices := make(map[string]string, len(batch))
	for _, item := range batch {
		if labelID := chosen(res.Answers[item.mail.ID], criteria); labelID != "" {
			choices[item.mail.ID] = labelID
		}
	}
	return choices, nil
}

func criteriaOf(guides []Guide) map[string]string {
	criteria := map[string]string{noneKey: noneDescription}
	for _, guide := range guides {
		if len(criteria) >= jev.MaxChoiceOptions {
			break
		}
		labelID := strings.TrimSpace(guide.LabelID)
		description := strings.TrimSpace(guide.Description)
		if labelID == "" || labelID == noneKey || description == "" {
			continue
		}
		criteria[labelID] = clip(description, MaxDescription)
	}
	return criteria
}

// MaxDescription matches the description stored for a label.
const MaxDescription = 400

func chosen(answer jev.Answer, criteria map[string]string) string {
	if answer.Choice == noneKey {
		return ""
	}
	if _, ok := criteria[answer.Choice]; ok {
		return answer.Choice
	}
	best, bestP := "", -1.0
	noneP := answer.Probabilities[noneKey]
	for key, probability := range answer.Probabilities {
		if key == noneKey {
			continue
		}
		if _, ok := criteria[key]; ok && probability > bestP {
			best, bestP = key, probability
		}
	}
	if best != "" && bestP > noneP {
		return best
	}
	return ""
}

func mailText(mail Mail) string {
	return "From: " + clip(mail.From, maxFrom) +
		"\nSubject: " + clip(mail.Subject, maxSubject) +
		"\nPreview: " + clip(mail.Snippet, maxSnippet) +
		"\nPick the one label whose description matches this email. Pick none when no description fits."
}

func dedupe(mail []Mail) []Mail {
	seen := map[string]bool{}
	out := make([]Mail, 0, len(mail))
	for _, item := range mail {
		id := strings.TrimSpace(item.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		item.ID = id
		out = append(out, item)
	}
	return out
}

func clip(text string, max int) string {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	runes := []rune(text)
	return string(runes[:max])
}
