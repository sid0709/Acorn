package agent

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

const (
	resumeQuestion  = "resume"
	resumeKeyPrefix = "resume_"
	// maxJobForChoice bounds the job text Jev reads beside the résumé names.
	maxJobForChoice = 1200
)

// Decider is the decision model that picks among things that already exist. *jev.Client is the real one.
type Decider interface {
	Decide(ctx context.Context, req jev.Request) (jev.Response, error)
}

// preferredFormats is the order a résumé's formats are tried when nothing says which to send:
// the one nearly every upload field takes first.
var preferredFormats = []string{"pdf", "docx", "doc", "rtf", "txt"}

// catalog lists what the model may name: each résumé stack with the formats it comes in,
// and each loose document (a file directly in the résumé folder).
func catalog(resumes []applicant.Resume) (stacks, documents []string) {
	formats := map[string][]string{}
	var order []string
	for _, resume := range resumes {
		if resume.Stack == "" {
			documents = append(documents, stem(resume)+" ("+resume.Format+")")
			continue
		}
		if _, seen := formats[resume.Stack]; !seen {
			order = append(order, resume.Stack)
		}
		formats[resume.Stack] = append(formats[resume.Stack], resume.Format)
	}
	for _, stack := range order {
		list := formats[stack]
		sort.SliceStable(list, func(i, j int) bool { return formatRank(list[i]) < formatRank(list[j]) })
		stacks = append(stacks, stack+" ("+strings.Join(list, ", ")+")")
	}
	return stacks, documents
}

// stem is a file's name without its extension, whatever case the extension is in.
func stem(resume applicant.Resume) string {
	if resume.Name != "" {
		return resume.Name
	}
	return strings.TrimSuffix(resume.FileName, filepath.Ext(resume.FileName))
}

// formatRank is a format's place in preferredFormats; an unlisted one comes last.
func formatRank(format string) int {
	for i, candidate := range preferredFormats {
		if candidate == format {
			return i
		}
	}
	return len(preferredFormats)
}

// stackNames are the résumé stacks, in order.
func stackNames(resumes []applicant.Resume) []string {
	var names []string
	seen := map[string]bool{}
	for _, resume := range resumes {
		if resume.Stack != "" && !seen[resume.Stack] {
			seen[resume.Stack] = true
			names = append(names, resume.Stack)
		}
	}
	return names
}

// pickResume chooses the file to upload. A loose document the model names (a cover letter)
// is sent as named. A résumé is never the model's pick: the résumé stack is the one chosen
// earlier in the run, or the only stack, else the one Jev chooses from the job description (or
// from the model's summary of the job when no description was found). A stack the model named
// is only a hint at the format: a named format ("docx", or a file of that format) is honoured, and
// otherwise the stack is sent in its preferred one. note says what happened when the choice was
// not clean: Jev failed and the first stack was used, or the model named another stack.
func (a *Agent) pickResume(ctx context.Context, s *session, requested string) (resume applicant.Resume, note string, err error) {
	resumes := s.snap.Resumes
	if len(resumes) == 0 {
		return applicant.Resume{}, "", errors.New("the applicant has no résumé files")
	}
	if found, ok := resolve(resumes, requested); ok && found.Stack == "" {
		return found, "", nil
	}
	stacks := stackNames(resumes)
	var stack string
	switch {
	case len(stacks) == 0:
		return applicant.Resume{}, "", errors.New("the applicant has no résumé folders, only loose documents")
	case s.resume != "" && contains(stacks, s.resume):
		stack = s.resume
	case len(stacks) == 1:
		stack = stacks[0]
	default:
		chosen, err := a.askJev(ctx, s, stacks)
		if err != nil {
			stack = stacks[0]
			note = fmt.Sprintf("the résumé choice failed (%v); uploading %s", err, stacks[0])
		} else {
			stack = chosen
		}
	}
	s.resume = stack
	if named, ok := resolve(resumes, requested); ok && !strings.EqualFold(named.Stack, stack) {
		s.notes = append(s.notes, fmt.Sprintf("You named the résumé %q, but Acorn chooses the résumé from the job description and sent %q. Leave resume null for a résumé.", named.Stack, stack))
	}
	return preferredOf(resumes, stack, requestedFormat(resumes, requested)), note, nil
}

func contains(list []string, item string) bool {
	for _, entry := range list {
		if entry == item {
			return true
		}
	}
	return false
}

// requestedFormat is the format a name asks for: a file's own format when the name is that
// file's id or name, or a format after a stack's name ("Python docx"); "" when it asks for none.
func requestedFormat(resumes []applicant.Resume, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	for _, resume := range resumes {
		if strings.EqualFold(resume.ID, name) || strings.EqualFold(resume.FileName, name) {
			return resume.Format
		}
	}
	for _, format := range preferredFormats {
		if strings.EqualFold(name, format) {
			return format // just a format: "docx"
		}
	}
	_, format := splitFormat(name)
	return format
}

// preferredOf is the stack's file in the format asked for, or in its preferred one.
func preferredOf(resumes []applicant.Resume, stack, format string) applicant.Resume {
	var files []applicant.Resume
	for _, resume := range resumes {
		if strings.EqualFold(resume.Stack, stack) {
			files = append(files, resume)
		}
	}
	if format != "" {
		var wanted []applicant.Resume
		for _, file := range files {
			if file.Format == format {
				wanted = append(wanted, file)
			}
		}
		if len(wanted) > 0 {
			files = wanted
		}
	}
	chosen, _ := preferred(files)
	return chosen
}

// resolve finds the file a name stands for, ignoring case: a file's id or name, or a stack
// or loose document by its name with an optional format after it ("C# + React", "C# + React.docx",
// "Cover Letter pdf"). A stack with no format named is sent in its preferred one.
func resolve(resumes []applicant.Resume, name string) (applicant.Resume, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return applicant.Resume{}, false
	}
	for _, resume := range resumes {
		if strings.EqualFold(resume.ID, name) || strings.EqualFold(resume.FileName, name) {
			return resume, true
		}
	}
	base, format := splitFormat(name)
	var matches []applicant.Resume
	for _, resume := range resumes {
		if (resume.Stack != "" && strings.EqualFold(resume.Stack, base)) || (resume.Stack == "" && strings.EqualFold(stem(resume), base)) {
			if format == "" || resume.Format == format {
				matches = append(matches, resume)
			}
		}
	}
	return preferred(matches)
}

// splitFormat separates a trailing format ("…docx", "….docx", "… (docx)") from a name.
func splitFormat(name string) (base, format string) {
	lower := strings.ToLower(strings.TrimSpace(name))
	for _, candidate := range preferredFormats {
		for _, suffix := range []string{"." + candidate, " " + candidate, " (" + candidate + ")"} {
			if strings.HasSuffix(lower, suffix) {
				return strings.TrimSpace(name[:len(name)-len(suffix)]), candidate
			}
		}
	}
	return strings.TrimSpace(name), ""
}

// preferred picks the file in the best format.
func preferred(files []applicant.Resume) (applicant.Resume, bool) {
	for _, format := range preferredFormats {
		for _, file := range files {
			if file.Format == format {
				return file, true
			}
		}
	}
	if len(files) > 0 {
		return files[0], true
	}
	return applicant.Resume{}, false
}

func (a *Agent) askJev(ctx context.Context, s *session, stacks []string) (string, error) {
	if len(stacks) > jev.MaxChoiceOptions {
		stacks = stacks[:jev.MaxChoiceOptions]
	}
	criteria := make(map[string]string, len(stacks))
	keys := make([]string, len(stacks))
	for i, stack := range stacks {
		key := fmt.Sprintf("%s%d", resumeKeyPrefix, i)
		keys[i] = key
		criteria[key] = stack
	}
	job := strings.TrimSpace(s.job)
	if job == "" {
		job = "(the job has not been described yet; this is the page the application started on: " + s.start.Title + ")"
	}
	posting := "Job the applicant is applying for:\n" + clipText(job, maxJobForChoice)
	if s.jd != "" {
		// The whole description, read from the page: far better to choose from than a one-line summary.
		posting = "Job description:\n" + clipText(s.jd, maxJDChars)
	}
	res, err := a.newDecider(s.key).Decide(ctx, jev.Request{
		State: posting + "\n\nApplicant profile:\n" + clipText(s.snap.Profile, maxJobForChoice*2),
		Questions: map[string]jev.Question{resumeQuestion: {
			Type:         jev.TypeChoice,
			Instructions: "Which résumé should the applicant upload for this job? Each name says what the résumé is for. Choose the one that fits the job best.",
			Criteria:     criteria,
		}},
	})
	if err != nil {
		return "", err
	}
	answer, ok := res.Answers[resumeQuestion]
	if !ok {
		return "", errors.New("the decision model returned no résumé answer")
	}
	for i, key := range keys {
		if key == answer.Choice {
			return stacks[i], nil
		}
	}
	return "", fmt.Errorf("the decision model chose %q, which is not a listed résumé", answer.Choice)
}
