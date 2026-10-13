package resume

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// generateTimeout bounds a whole run: every configured step, in the sections' parallel series.
const generateTimeout = 4 * time.Minute

// progressIndex is the progress row of the plan's i-th step; "load-jd" is row 1.
func progressIndex(i int) int { return i + 2 }

func (s *Service) enqueue(ctx context.Context, accountID string, identity Identity, jobDescription, jobID string, checkpoint map[string]any, model Model) (Task, error) {
	jobDescription = strings.TrimSpace(jobDescription)
	if jobDescription == "" {
		return Task{}, fmt.Errorf("%w: job description is required", ErrInvalid)
	}
	if len(jobDescription) > maxJobDescription {
		return Task{}, fmt.Errorf("%w: job description is too long", ErrInvalid)
	}
	if model == nil || !model.Ready() {
		return Task{}, ErrUnavailable
	}
	cfg := s.Config(accountID)
	p, err := buildPlan(cfg, identity, jobDescription, strings.TrimSpace(jobID) != "")
	if err != nil {
		return Task{}, err
	}
	id, err := newID()
	if err != nil {
		return Task{}, err
	}
	now := time.Now().UTC()
	partial := map[string]any{}
	resumeFrom := ""
	if checkpoint != nil {
		if raw, ok := checkpoint["partialSections"].(map[string]any); ok {
			partial = cloneMap(raw)
		}
		resumeFrom = asString(checkpoint["resumeFrom"])
	}
	task := Task{
		ID:             id,
		AccountID:      accountID,
		Status:         "running",
		JobDescription: jobDescription,
		JobID:          strings.TrimSpace(jobID),
		TemplateID:     asString(cfg["templateId"]),
		Identity:       identity,
		Config:         cfg,
		Partial:        partial,
		ResumeFrom:     resumeFrom,
		Progress:       newProgress(p),
		StartedAt:      now,
	}
	s.store.putTask(task)
	if ctx == nil {
		ctx = context.Background()
	}
	parent := context.WithoutCancel(ctx)
	if s.syncRun {
		s.runTask(parent, task, model)
		done, ok := s.store.task(accountID, task.ID)
		if ok {
			return done, nil
		}
		return task, nil
	}
	go s.runTask(parent, task, model)
	return task, nil
}

func newProgress(p plan) Progress {
	steps := []ProgressStep{{Index: 1, Name: "load-jd", Purpose: "load-jd", Kind: stepFinal, Status: "pending"}}
	for i, step := range p.steps {
		steps = append(steps, ProgressStep{Index: progressIndex(i), Name: step.Name, Purpose: step.Purpose, Kind: step.Kind, Status: "pending"})
	}
	steps = append(steps, ProgressStep{Index: progressIndex(len(p.steps)), Name: "finalize", Purpose: "finalize", Kind: stepFinal, Status: "pending"})
	return Progress{Steps: steps}
}

func (s *Service) runTask(parent context.Context, task Task, model Model) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, generateTimeout)
	defer cancel()
	finalizeIndex := len(task.Progress.Steps)
	fail := func(message string) {
		task.Status = "failed"
		task.Error = message
		task.FinishedAt = ptrTime(time.Now().UTC())
		s.store.putTask(snapshot(task))
		s.persistFailed(task, model)
	}

	p, err := buildPlan(task.Config, task.Identity, task.JobDescription, task.JobID != "")
	if err != nil {
		fail(err.Error())
		return
	}
	sections := cloneMap(task.Partial)
	if sections == nil {
		sections = map[string]any{}
	}
	run := &runner{svc: s, model: model, plan: p, task: &task, sections: sections}
	run.mark(1, "done")
	if err := run.run(ctx, task.ResumeFrom); err != nil {
		fail(err.Error())
		return
	}

	sections["experience"] = reconcileExperience(sections["experience"], task.Identity.Careers, p.dynamic)
	task.Partial = cloneMap(sections)
	if err := assertSections(sections, task.Identity.Careers); err != nil {
		fail(err.Error())
		return
	}

	run.mark(finalizeIndex, "running")
	docx, err := s.renderBytes(task.AccountID, task.Identity, sections, task.Config)
	if err != nil {
		fail(err.Error())
		return
	}
	genID, err := newID()
	if err != nil {
		fail(err.Error())
		return
	}
	now := time.Now().UTC()
	gen := Generation{
		ID:             genID,
		AccountID:      task.AccountID,
		InputID:        task.ID,
		Status:         "completed",
		Provider:       asString(task.Config["provider"]),
		Model:          model.Model(),
		JobDescription: task.JobDescription,
		TechStack:      stackFromSections(sections),
		TemplateID:     task.TemplateID,
		JobID:          task.JobID,
		Sections:       sections,
		Identity:       task.Identity,
		Config:         task.Config,
		StartedAt:      task.StartedAt,
		FinishedAt:     &now,
		Docx:           docx,
	}
	lib, err := s.saveGeneratedLibrary(task.AccountID, gen, docx)
	if err != nil {
		fail(err.Error())
		return
	}
	gen.ResumeID = lib.ID
	s.store.putGeneration(gen)
	s.store.rememberJob(task.AccountID, task.JobID, lib.ID)
	task.Status = "completed"
	task.GenerationID = gen.ID
	task.ResumeID = lib.ID
	task.Partial = sections
	task.Progress.Done = true
	task.FinishedAt = &now
	run.mark(finalizeIndex, "done")
}

func (s *Service) persistFailed(task Task, model Model) {
	genID, err := newID()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	s.store.putGeneration(Generation{
		ID:             genID,
		AccountID:      task.AccountID,
		InputID:        task.ID,
		Status:         "failed",
		Provider:       asString(task.Config["provider"]),
		Model:          modelName(model),
		JobDescription: task.JobDescription,
		TemplateID:     task.TemplateID,
		JobID:          task.JobID,
		Sections:       task.Partial,
		Identity:       task.Identity,
		Config:         task.Config,
		Error:          task.Error,
		StartedAt:      task.StartedAt,
		FinishedAt:     &now,
	})
}

func (s *Service) renderBytes(accountID string, identity Identity, sections map[string]any, cfg map[string]any) ([]byte, error) {
	templateID := asString(cfg["templateId"])
	if strings.HasPrefix(templateID, "upload:") {
		id := strings.TrimPrefix(templateID, "upload:")
		tpl, ok := s.store.template(accountID, id)
		if !ok {
			return nil, fmt.Errorf("%w: uploaded template is gone", ErrNotFound)
		}
		return fillTemplateDocx(tpl.Docx, fillValues(identity, sections, templateID))
	}
	return renderDocx(identity, sections, cfg)
}

func (s *Service) saveGeneratedLibrary(accountID string, gen Generation, docx []byte) (LibraryRow, error) {
	id, err := newID()
	if err != nil {
		return LibraryRow{}, err
	}
	now := time.Now().UTC()
	row := LibraryRow{
		ID:            id,
		AccountID:     accountID,
		Source:        "generated",
		FileName:      fileNameFor(gen.Identity),
		Title:         gen.TechStack,
		Size:          len(docx),
		GenerationID:  gen.ID,
		TemplateID:    gen.TemplateID,
		JobID:         gen.JobID,
		UploadedAt:    now,
		MimeType:      docxMIME,
		Bytes:         docx,
		Analyzed:      true,
		AnalyzedAt:    &now,
		ExtractedText: resumeSearchText(gen),
	}
	if row.Title == "" {
		row.Title = "Generated"
	}
	if err := s.store.putLibrary(row); err != nil {
		return LibraryRow{}, err
	}
	return row, nil
}

func modelName(model Model) string {
	if model == nil {
		return ""
	}
	return model.Model()
}

func stackFromSections(sections map[string]any) string {
	content := normalizeSections(sections)
	if len(content.Skills) == 0 {
		return "Generated"
	}
	return content.Skills[0].Category
}
