package resume

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

type Service struct {
	store   *Store
	model   Model
	syncRun bool
}

// RunInline finishes generation before Enqueue returns. Tests use it so they do not wait on a goroutine.
func (s *Service) RunInline() { s.syncRun = true }

func New(store *Store, model Model) *Service {
	if store == nil {
		store = NewMemory()
	}
	return &Service{store: store, model: model}
}

func (s *Service) EnsureIndexes(ctx context.Context) error {
	return s.store.EnsureIndexes(ctx)
}

func (s *Service) Config(accountID string) map[string]any {
	if cfg := s.store.config(accountID); cfg != nil {
		return cfg
	}
	return defaultConfig()
}

func (s *Service) SaveConfig(accountID string, cfg map[string]any) map[string]any {
	merged := mergeConfig(cfg)
	delete(merged, "jobDescription")
	s.store.saveConfig(accountID, merged)
	return merged
}

func (s *Service) Preview(accountID string, identity Identity, sections, cfg map[string]any) string {
	if cfg == nil {
		cfg = s.Config(accountID)
	}
	return renderHTML(identity, sections, cfg)
}

func (s *Service) UploadTemplate(accountID, name, fileName string, data []byte) (UploadedTemplate, error) {
	if len(data) == 0 || len(data) > maxFileBytes {
		return UploadedTemplate{}, fmt.Errorf("%w: upload a .docx under 8 MB", ErrInvalid)
	}
	if !strings.HasSuffix(strings.ToLower(fileName), ".docx") {
		return UploadedTemplate{}, fmt.Errorf("%w: templates must be .docx", ErrInvalid)
	}
	slots, sections, warnings, err := parseTemplateDocx(data)
	if err != nil {
		return UploadedTemplate{}, fmt.Errorf("%w: could not read that DOCX", ErrInvalid)
	}
	id, err := newID()
	if err != nil {
		return UploadedTemplate{}, err
	}
	if strings.TrimSpace(name) == "" {
		name = strings.TrimSuffix(fileName, ".docx")
	}
	row := UploadedTemplate{
		ID: id, AccountID: accountID, Name: name, FileName: fileName,
		SlotCount: len(slots), SectionsFound: sections, Slots: slots, Warnings: warnings,
		UploadedAt: time.Now().UTC(), Docx: data,
	}
	s.store.putTemplate(row)
	row.Docx = nil
	return row, nil
}

func (s *Service) Templates(accountID string) []UploadedTemplate {
	return s.store.listTemplates(accountID)
}

func (s *Service) DeleteTemplate(accountID, id string) error {
	if !s.store.deleteTemplate(accountID, id) {
		return ErrNotFound
	}
	return nil
}

func (s *Service) Enqueue(accountID string, identity Identity, jobDescription, jobID string, checkpoint map[string]any) (Task, error) {
	if identity.FullName == "" {
		return Task{}, fmt.Errorf("%w: identity is required", ErrInvalid)
	}
	return s.enqueue(accountID, identity, jobDescription, jobID, checkpoint)
}

func (s *Service) Continue(accountID, inputID string, identity Identity, jobDescription, jobID string, checkpoint map[string]any) (Task, error) {
	existing, ok := s.store.task(accountID, inputID)
	if ok {
		if identity.FullName == "" {
			identity = existing.Identity
		}
		if jobDescription == "" {
			jobDescription = existing.JobDescription
		}
		jobID = firstNonEmpty(jobID, existing.JobID)
	}
	return s.Enqueue(accountID, identity, jobDescription, jobID, checkpoint)
}

func (s *Service) Poll(accountID, inputID string) (Task, error) {
	task, ok := s.store.task(accountID, inputID)
	if !ok {
		if gen, found := s.store.generationByInput(accountID, inputID); found {
			return Task{ID: inputID, AccountID: accountID, Status: gen.Status, GenerationID: gen.ID, ResumeID: gen.ResumeID, Error: gen.Error, Partial: gen.Sections}, nil
		}
		return Task{}, ErrNotFound
	}
	return task, nil
}

func (s *Service) History(accountID string, query HistoryQuery) (runs []Generation, total int, facets map[string]any) {
	rows := filterHistory(s.store.listGenerations(accountID), query)
	total = len(rows)
	if query.Limit <= 0 {
		query.Limit = historyDefault
	}
	if query.Limit > historyMaxLimit {
		query.Limit = historyMaxLimit
	}
	if query.Offset < 0 {
		query.Offset = 0
	}
	page := pageSlice(rows, query.Limit, query.Offset)
	if query.Facets {
		facets = historyFacets(s.store.listGenerations(accountID))
	}
	return page, total, facets
}

func (s *Service) Generation(accountID, id string) (Generation, error) {
	row, ok := s.store.generation(accountID, id)
	if !ok {
		return Generation{}, ErrNotFound
	}
	return row, nil
}

func (s *Service) DeleteGeneration(accountID, id string) error {
	gen, ok := s.store.generation(accountID, id)
	if !ok {
		return ErrNotFound
	}
	if gen.ResumeID != "" {
		_ = s.store.deleteLibrary(accountID, gen.ResumeID)
	}
	if !s.store.deleteGeneration(accountID, id) {
		return ErrNotFound
	}
	return nil
}

func (s *Service) GenerationDocx(accountID, id string) ([]byte, string, error) {
	gen, err := s.Generation(accountID, id)
	if err != nil {
		return nil, "", err
	}
	data := gen.Docx
	if len(data) == 0 {
		data, err = s.renderBytes(accountID, gen.Identity, gen.Sections, gen.Config)
		if err != nil {
			return nil, "", err
		}
	}
	return data, fileNameFor(gen.Identity), nil
}

func (s *Service) GenerationPreview(accountID, id string) (string, error) {
	gen, err := s.Generation(accountID, id)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(gen.TemplateID, "upload:") && len(gen.Docx) > 0 {
		return htmlFromDocx(gen.Docx), nil
	}
	return renderHTML(gen.Identity, gen.Sections, gen.Config), nil
}

func (s *Service) UploadLibrary(accountID, name, title string, data []byte) (LibraryRow, error) {
	if len(data) == 0 || len(data) > maxFileBytes {
		return LibraryRow{}, fmt.Errorf("%w: file is empty or too large", ErrInvalid)
	}
	id, err := newID()
	if err != nil {
		return LibraryRow{}, err
	}
	if strings.TrimSpace(name) == "" {
		name = "resume"
	}
	if strings.TrimSpace(title) == "" {
		title = strings.TrimSuffix(name, filepathExt(name))
	}
	text := extractFileText(name, data)
	row := LibraryRow{
		ID: id, AccountID: accountID, Source: "uploaded", FileName: name, Title: title,
		Size: len(data), UploadedAt: time.Now().UTC(), ExtractedText: text,
		MimeType: mimeFromName(name), Bytes: data, Skills: analyzeText(text),
	}
	existing := s.store.listLibrary(accountID)
	if len(existing) == 0 {
		row.IsPrimary = true
	}
	if err := s.store.putLibrary(row); err != nil {
		return LibraryRow{}, err
	}
	row.Bytes = nil
	return row, nil
}

func (s *Service) Library(accountID string) []LibraryRow {
	return s.store.listLibrary(accountID)
}

func (s *Service) LibraryItem(accountID, id string) (LibraryRow, error) {
	row, ok := s.store.libraryItem(accountID, id)
	if !ok {
		return LibraryRow{}, ErrNotFound
	}
	return row, nil
}

func (s *Service) DeleteLibrary(accountID, id string) error {
	if !s.store.deleteLibrary(accountID, id) {
		return ErrNotFound
	}
	return nil
}

func (s *Service) SetPrimary(accountID, id string) (LibraryRow, error) {
	target, ok := s.store.libraryItem(accountID, id)
	if !ok {
		return LibraryRow{}, ErrNotFound
	}
	for _, row := range s.store.listLibrary(accountID) {
		full, found := s.store.libraryItem(accountID, row.ID)
		if !found {
			continue
		}
		full.IsPrimary = full.ID == id
		if err := s.store.putLibrary(full); err != nil {
			return LibraryRow{}, err
		}
	}
	target.IsPrimary = true
	target.Bytes = nil
	return target, nil
}

func (s *Service) LibraryFile(accountID, id string) (FilePayload, error) {
	row, ok := s.store.libraryItem(accountID, id)
	if !ok || len(row.Bytes) == 0 {
		return FilePayload{}, ErrNotFound
	}
	return FilePayload{
		Key: "recommended_resume", Name: row.FileName, MimeType: row.MimeType,
		Base64: base64.StdEncoding.EncodeToString(row.Bytes), Label: row.Title, ResumeID: row.ID, JobID: row.JobID,
	}, nil
}

func (s *Service) LibraryPreview(accountID, id string) (string, error) {
	row, ok := s.store.libraryItem(accountID, id)
	if !ok {
		return "", ErrNotFound
	}
	if strings.HasSuffix(strings.ToLower(row.FileName), ".docx") && len(row.Bytes) > 0 {
		return htmlFromDocx(row.Bytes), nil
	}
	return "<p>" + htmlEscape(row.ExtractedText) + "</p>", nil
}

func (s *Service) GeneratedFile(accountID, generationID string) (FilePayload, error) {
	gen, err := s.Generation(accountID, generationID)
	if err != nil {
		return FilePayload{}, err
	}
	data := gen.Docx
	if len(data) == 0 {
		data, err = s.renderBytes(accountID, gen.Identity, gen.Sections, gen.Config)
		if err != nil {
			return FilePayload{}, err
		}
	}
	return FilePayload{
		Key: "custom_resume", Name: fileNameFor(gen.Identity), MimeType: docxMIME,
		Base64: base64.StdEncoding.EncodeToString(data), Label: gen.TechStack, ResumeID: gen.ResumeID,
	}, nil
}

func (s *Service) DeleteAccount(ctx context.Context, accountID string) error {
	if s == nil || s.store == nil {
		return nil
	}
	return s.store.DeleteAccount(ctx, accountID)
}

func (s *Service) Recommend(accountID, jobDescription, jobID string) (id, stack, reason string, err error) {
	id, stack, reason, err = s.recommend(accountID, jobDescription)
	if err == nil && jobID != "" {
		s.store.rememberJob(accountID, jobID, id)
	}
	return id, stack, reason, err
}

func (s *Service) JobResume(accountID, jobID string) (FilePayload, string, string, error) {
	ref := s.store.jobFile(accountID, jobID)
	if ref == "" {
		return FilePayload{}, "", "", ErrNotFound
	}
	if row, ok := s.store.libraryItem(accountID, ref); ok {
		file, err := s.LibraryFile(accountID, row.ID)
		file.Key = "recommended_resume"
		file.JobID = jobID
		return file, row.ID, row.Title, err
	}
	if gen, ok := s.store.generation(accountID, ref); ok {
		file, err := s.GeneratedFile(accountID, gen.ID)
		file.JobID = jobID
		return file, gen.ResumeID, gen.TechStack, err
	}
	return FilePayload{}, "", "", ErrNotFound
}

func (s *Service) JobPreview(accountID, jobID string) (string, error) {
	ref := s.store.jobFile(accountID, jobID)
	if ref == "" {
		return "", ErrNotFound
	}
	if _, ok := s.store.libraryItem(accountID, ref); ok {
		return s.LibraryPreview(accountID, ref)
	}
	return s.GenerationPreview(accountID, ref)
}

func defaultConfig() map[string]any {
	theme := map[string]any{
		"font": defaultFont, "baseSize": baseSizeRange.def, "nameSize": nameSizeRange.def, "titleSize": titleSizeRange.def,
		"accent": defaultAccent, "text": defaultText, "headerAlign": "center", "paper": "letter",
		"margin": marginRange.def, "sectionGap": sectionGapRange.def, "entryGap": entryGapRange.def, "lineHeight": lineHeightRange.def,
	}
	return map[string]any{
		"schemaVersion": 4, "provider": "openai", "model": "gpt-5-nano",
		"reasoningEffort": "low", "dynamicCareerTitles": false, "templateId": "classic",
		"theme": theme, "systemInstruction": systemWriter, "jobDescription": "",
		"coverage": map[string]any{"enabled": false, "experienceRequirementThreshold": 4, "aliases": map[string]any{}},
	}
}

func mergeConfig(raw map[string]any) map[string]any {
	base := defaultConfig()
	if raw == nil {
		return base
	}
	for key, value := range raw {
		if value != nil {
			base[key] = value
		}
	}
	if asString(base["templateId"]) == "" {
		base["templateId"] = "classic"
	}
	return base
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func filepathExt(name string) string {
	i := strings.LastIndex(name, ".")
	if i < 0 {
		return ""
	}
	return name[i:]
}

func mimeFromName(name string) string {
	switch strings.ToLower(filepathExt(name)) {
	case ".pdf":
		return "application/pdf"
	case ".docx":
		return docxMIME
	case ".doc":
		return "application/msword"
	default:
		return "text/plain"
	}
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return replacer.Replace(value)
}

func PublicRow(row LibraryRow) map[string]any {
	analyzedAt := ""
	if row.AnalyzedAt != nil {
		analyzedAt = row.AnalyzedAt.Format(time.RFC3339)
	}
	profile := row.SkillProfile
	if profile == nil {
		profile = []SkillEntry{}
	}
	return map[string]any{
		"id": row.ID, "source": row.Source, "fileName": row.FileName, "title": row.Title,
		"size": row.Size, "isPrimary": row.IsPrimary, "analyzed": row.Analyzed,
		"analyzedAt": analyzedAt, "generationId": row.GenerationID, "templateId": row.TemplateID,
		"uploadedAt": row.UploadedAt.Format(time.RFC3339), "extractedText": row.ExtractedText,
		"skillCount": len(profile), "skillProfile": profile,
	}
}

func PublicRun(row Generation) map[string]any {
	finished := ""
	if row.FinishedAt != nil {
		finished = row.FinishedAt.Format(time.RFC3339)
	}
	return map[string]any{
		"id": row.ID, "_id": row.ID, "status": row.Status, "provider": row.Provider, "model": row.Model,
		"jobDescription": row.JobDescription, "techStack": row.TechStack, "templateId": row.TemplateID,
		"startedAt": row.StartedAt.Format(time.RFC3339), "finishedAt": finished, "error": row.Error,
		"sections": row.Sections, "identity": row.Identity, "config": map[string]any{"templateId": row.TemplateID},
	}
}

func PublicTemplate(row UploadedTemplate) map[string]any {
	return map[string]any{
		"id": row.ID, "name": row.Name, "fileName": row.FileName, "slotCount": row.SlotCount,
		"sectionsFound": row.SectionsFound, "slots": row.Slots, "warnings": row.Warnings,
		"uploadedAt": row.UploadedAt.Format(time.RFC3339), "source": "uploaded", "format": "docx",
	}
}
