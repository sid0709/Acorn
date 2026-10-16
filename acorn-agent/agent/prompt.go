package agent

import (
	_ "embed"
	"fmt"
	"strings"
	"text/template"
	"time"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
)

//go:embed prompts/system.md
var systemTemplateText string

var systemTemplate = template.Must(template.New("system").Parse(systemTemplateText))

type systemData struct {
	StopBeforeSubmit bool
	// Survey is true when the run may look at a whole page as a survey of screenshots.
	Survey bool
	// Checks is true when a decision model checks the screen between the model's steps, so
	// the model may plan ahead and say what each run of actions should lead to.
	Checks     bool
	MaxActions int
	// Chunk is the most actions that run before the screen is checked.
	Chunk     int
	Profile   string
	Token     string
	Stacks    []string
	Documents []string
	Today     string
}

// systemPrompt is the standing instruction: the task, how to answer, and who the applicant is.
// It is the same on every step of a run, so the provider can cache it.
func systemPrompt(start Start, snapshot applicant.Snapshot, maxActions, chunk int, checks bool, now time.Time) (string, error) {
	stacks, documents := catalog(snapshot.Resumes)
	var out strings.Builder
	err := systemTemplate.Execute(&out, systemData{
		StopBeforeSubmit: start.StopBeforeSubmit,
		Survey:           start.Survey,
		Checks:           checks,
		MaxActions:       maxActions,
		Chunk:            chunk,
		Profile:          snapshot.Profile,
		Token:            applicant.AccountPasswordToken,
		Stacks:           stacks,
		Documents:        documents,
		Today:            now.Format("2006-01-02"),
	})
	if err != nil {
		return "", fmt.Errorf("build system prompt: %w", err)
	}
	return out.String(), nil
}

// observationText is what the model is told about a step beside the screenshot itself. It
// is kept with the step in the history. results are what happened to every action sent since
// the model last looked, and notes are what the page and the agent have to add.
func observationText(step, maxSteps int, obs Observation, results []ActionResult, notes []string, stale int) string {
	var out strings.Builder
	fmt.Fprintf(&out, "Step %d of at most %d.\n", step, maxSteps)
	fmt.Fprintf(&out, "Page: %s (%s)\n", orNone(obs.Title), orNone(obs.URL))
	fmt.Fprintf(&out, "Screenshot: %dx%d pixels. %s\n", obs.Viewport.Width, obs.Viewport.Height, scrollLine(obs.Viewport))
	out.WriteString(focusLine(obs.Focus))
	if len(results) > 0 {
		out.WriteString("Results of your last actions:\n")
		for _, result := range results {
			out.WriteString("- " + resultLine(result) + "\n")
		}
	}
	for _, note := range notes {
		out.WriteString("Note: " + note + "\n")
	}
	if stale >= 1 {
		fmt.Fprintf(&out, "Check: the screen looks the same as after your previous actions (%d step%s in a row). If required-field warnings still show but the fields already look filled, do not refill them; move on or report stuck (page_problem). Otherwise find out why before you repeat the same edit.\n", stale, plural(stale))
	}
	return strings.TrimRight(out.String(), "\n")
}

// currentText is the newest step's text: what the step says, then the model's own notes in
// full, then the request. Only this step carries the notes, so they are paid for once.
func currentText(body, memo, job string) string {
	var out strings.Builder
	out.WriteString(body + "\n")
	if job = strings.TrimSpace(job); job != "" {
		out.WriteString("Job you recorded: " + job + "\n")
	}
	if memo = strings.TrimSpace(memo); memo != "" {
		out.WriteString("Your notes so far:\n" + memo + "\n")
	} else {
		out.WriteString("Your notes so far: (none yet: this is the first step)\n")
	}
	out.WriteString("Answer with the JSON object.")
	return out.String()
}

func orNone(text string) string {
	if strings.TrimSpace(text) == "" {
		return "none"
	}
	return text
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func scrollLine(vp Viewport) string {
	if vp.PageHeight <= 0 {
		return ""
	}
	below := vp.PageHeight - vp.ScrollY - float64(vp.Height)
	above := vp.ScrollY
	switch {
	case below > 8 && above > 8:
		return fmt.Sprintf("The page is scrolled: about %.0f px lies above and %.0f px below.", above, below)
	case below > 8:
		return fmt.Sprintf("The page is at its top; about %.0f px lies below.", below)
	case above > 8:
		return fmt.Sprintf("The page is at its bottom; about %.0f px lies above.", above)
	}
	return "The whole page fits on the screen."
}

func focusLine(focus *Focus) string {
	if focus == nil {
		return "Keyboard focus: no control.\n"
	}
	parts := []string{focus.Tag}
	if focus.Type != "" {
		parts = append(parts, "type "+focus.Type)
	}
	if focus.Label != "" {
		parts = append(parts, fmt.Sprintf("labelled %q", focus.Label))
	}
	if focus.Value != "" {
		parts = append(parts, fmt.Sprintf("value %q", focus.Value))
	}
	if focus.Checked != nil {
		parts = append(parts, fmt.Sprintf("checked %t", *focus.Checked))
	}
	if focus.Required {
		parts = append(parts, "required")
	}
	if focus.Invalid != "" {
		parts = append(parts, fmt.Sprintf("the page says %q", focus.Invalid))
	}
	line := "Keyboard focus: " + strings.Join(parts, ", ") + ".\n"
	if len(focus.Options) > 0 {
		kind := "Its options"
		if focus.Multiple {
			kind = "Its options (several may be chosen)"
		}
		line += kind + ": " + strings.Join(focus.Options, " | ") + ".\n"
	}
	return line
}

func resultLine(result ActionResult) string {
	status := "done"
	if !result.OK {
		status = "failed"
	}
	line := result.ID + " " + status
	if result.Error != "" {
		line += ": " + result.Error
	}
	if result.Opened == OpenedFilePicker {
		line += " (this click opened a file picker that you cannot see, and no file was chosen: to attach a file, use upload at this point)"
	}
	if result.Detail != "" {
		line += " (" + result.Detail + ")"
	}
	return line
}

// describe is one line saying what a step did, for the run's history.
func describe(action Action) string {
	switch action.Kind {
	case KindType:
		if action.Secret {
			return fmt.Sprintf("type [%d secret characters]", len([]rune(action.Text)))
		}
		return fmt.Sprintf("type %q", clipText(action.Text, 60))
	case KindKey:
		return "key " + action.Keys
	case KindScroll:
		return fmt.Sprintf("scroll %.0f,%.0f", action.DX, action.DY)
	case KindWait:
		return fmt.Sprintf("wait %dms", action.Ms)
	case KindUpload:
		if action.FileName != "" {
			return fmt.Sprintf("upload %s at %s", action.FileName, at(action))
		}
		return "upload at " + at(action)
	}
	return action.Kind + " at " + at(action)
}

func at(action Action) string {
	if action.X == nil || action.Y == nil {
		return "?"
	}
	return fmt.Sprintf("%.0f,%.0f", *action.X, *action.Y)
}

func clipText(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max]) + "…"
}
