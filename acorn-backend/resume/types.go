package resume

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	configsCollection     = "acorn_resume_configs"
	templatesCollection   = "acorn_resume_templates"
	generationsCollection = "acorn_resume_generations"
	libraryCollection     = "acorn_resume_library"
	tasksCollection       = "acorn_resume_tasks"

	maxJobDescription = 20000
	maxFileBytes      = 8 << 20
	historyMaxLimit   = 100
	historyDefault    = 15
	docxMIME          = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

var (
	ErrInvalid     = errors.New("invalid résumé request")
	ErrNotFound    = errors.New("résumé not found")
	ErrUnavailable = errors.New("the AI model is not configured")
	ErrNoLibrary   = errors.New("no library résumé matched this posting")
)

type Model interface {
	JSON(ctx context.Context, system, user string, schema json.RawMessage) ([]byte, error)
	Model() string
	Ready() bool
}

// Identity is the person the résumé is written for.
type Identity struct {
	FullName  string           `json:"fullName" bson:"fullName"`
	Location  string           `json:"location" bson:"location"`
	Email     string           `json:"email" bson:"email"`
	Phone     string           `json:"phone" bson:"phone"`
	Linkedin  string           `json:"linkedin" bson:"linkedin"`
	Careers   []CareerEntry    `json:"careers" bson:"careers"`
	Education []EducationEntry `json:"education" bson:"education"`
}

type CareerEntry struct {
	Company     string `json:"company" bson:"company"`
	Title       string `json:"title" bson:"title"`
	Period      string `json:"period" bson:"period"`
	Description string `json:"description" bson:"description"`
}

type EducationEntry struct {
	School string `json:"school" bson:"school"`
	Degree string `json:"degree" bson:"degree"`
	Period string `json:"period" bson:"period"`
}

type TemplateSlot struct {
	Index           int    `json:"index" bson:"index"`
	ParagraphIndex  int    `json:"paragraphIndex" bson:"paragraphIndex"`
	Section         string `json:"section" bson:"section"`
	CompanyHint     string `json:"companyHint,omitempty" bson:"companyHint,omitempty"`
	IsBullet        bool   `json:"isBullet" bson:"isBullet"`
	ExperienceIndex *int   `json:"experienceIndex,omitempty" bson:"experienceIndex,omitempty"`
	Token           string `json:"token,omitempty" bson:"token,omitempty"`
	Kind            string `json:"kind,omitempty" bson:"kind,omitempty"`
}

type UploadedTemplate struct {
	ID            string         `json:"id" bson:"id"`
	AccountID     string         `json:"-" bson:"accountId"`
	Name          string         `json:"name" bson:"name"`
	FileName      string         `json:"fileName" bson:"fileName"`
	SlotCount     int            `json:"slotCount" bson:"slotCount"`
	SectionsFound []string       `json:"sectionsFound" bson:"sectionsFound"`
	Slots         []TemplateSlot `json:"slots" bson:"slots"`
	Warnings      []string       `json:"warnings" bson:"warnings"`
	UploadedAt    time.Time      `json:"uploadedAt" bson:"uploadedAt"`
	Docx          []byte         `json:"-" bson:"docx"`
}

// SkillEntry is one skill from résumé analysis: a name, a radar category, and a level from 2 to 5.
type SkillEntry struct {
	Name     string `json:"name" bson:"name"`
	Category string `json:"category" bson:"category"`
	Level    int    `json:"level" bson:"level"`
}

type LibraryRow struct {
	ID            string       `json:"id" bson:"id"`
	AccountID     string       `json:"-" bson:"accountId"`
	Source        string       `json:"source" bson:"source"`
	FileName      string       `json:"fileName" bson:"fileName"`
	Title         string       `json:"title" bson:"title"`
	Size          int          `json:"size" bson:"size"`
	IsPrimary     bool         `json:"isPrimary" bson:"isPrimary"`
	Analyzed      bool         `json:"analyzed" bson:"analyzed"`
	AnalyzedAt    *time.Time   `json:"analyzedAt" bson:"analyzedAt,omitempty"`
	GenerationID  string       `json:"generationId,omitempty" bson:"generationId,omitempty"`
	TemplateID    string       `json:"templateId,omitempty" bson:"templateId,omitempty"`
	JobID         string       `json:"jobId,omitempty" bson:"jobId,omitempty"`
	UploadedAt    time.Time    `json:"uploadedAt" bson:"uploadedAt"`
	ExtractedText string       `json:"extractedText,omitempty" bson:"extractedText,omitempty"`
	Skills        []string     `json:"skills,omitempty" bson:"skills,omitempty"`
	SkillProfile  []SkillEntry `json:"skillProfile,omitempty" bson:"skillProfile,omitempty"`
	MimeType      string       `json:"mimeType" bson:"mimeType"`
	Bytes         []byte       `json:"-" bson:"bytes"`
}

type Generation struct {
	ID             string         `json:"id" bson:"id"`
	AccountID      string         `json:"-" bson:"accountId"`
	InputID        string         `json:"inputId" bson:"inputId"`
	Status         string         `json:"status" bson:"status"`
	Provider       string         `json:"provider" bson:"provider"`
	Model          string         `json:"model" bson:"model"`
	JobDescription string         `json:"jobDescription" bson:"jobDescription"`
	TechStack      string         `json:"techStack" bson:"techStack"`
	TemplateID     string         `json:"templateId" bson:"templateId"`
	JobID          string         `json:"jobId,omitempty" bson:"jobId,omitempty"`
	ResumeID       string         `json:"resumeId,omitempty" bson:"resumeId,omitempty"`
	Sections       map[string]any `json:"sections,omitempty" bson:"sections,omitempty"`
	Identity       Identity       `json:"identity,omitempty" bson:"identity,omitempty"`
	Config         map[string]any `json:"config,omitempty" bson:"config,omitempty"`
	Error          string         `json:"error,omitempty" bson:"error,omitempty"`
	StartedAt      time.Time      `json:"startedAt" bson:"startedAt"`
	FinishedAt     *time.Time     `json:"finishedAt,omitempty" bson:"finishedAt,omitempty"`
	Docx           []byte         `json:"-" bson:"docx,omitempty"`
}

type Task struct {
	ID             string         `json:"id" bson:"id"`
	AccountID      string         `json:"-" bson:"accountId"`
	Status         string         `json:"status" bson:"status"`
	GenerationID   string         `json:"generationId,omitempty" bson:"generationId,omitempty"`
	ResumeID       string         `json:"resumeId,omitempty" bson:"resumeId,omitempty"`
	JobDescription string         `json:"jobDescription" bson:"jobDescription"`
	JobID          string         `json:"jobId,omitempty" bson:"jobId,omitempty"`
	TemplateID     string         `json:"templateId" bson:"templateId"`
	Identity       Identity       `json:"identity" bson:"identity"`
	Config         map[string]any `json:"config" bson:"config"`
	Partial        map[string]any `json:"partialSections,omitempty" bson:"partialSections,omitempty"`
	Progress       Progress       `json:"progress" bson:"progress"`
	Error          string         `json:"error,omitempty" bson:"error,omitempty"`
	ResumeFrom     string         `json:"resumeFrom,omitempty" bson:"resumeFrom,omitempty"`
	StartedAt      time.Time      `json:"startedAt" bson:"startedAt"`
	FinishedAt     *time.Time     `json:"finishedAt,omitempty" bson:"finishedAt,omitempty"`
}

type Progress struct {
	Steps   []ProgressStep `json:"steps" bson:"steps"`
	Done    bool           `json:"done" bson:"done"`
	Message string         `json:"message,omitempty" bson:"message,omitempty"`
}

type ProgressStep struct {
	Index   int    `json:"index" bson:"index"`
	Name    string `json:"name" bson:"name"`
	Purpose string `json:"purpose" bson:"purpose"`
	Kind    string `json:"kind" bson:"kind"`
	Status  string `json:"status" bson:"status"`
}

type HistoryQuery struct {
	Search     string
	SearchIn   string
	Status     string
	Model      string
	Provider   string
	TemplateID string
	From       time.Time
	To         time.Time
	Sort       string
	Limit      int
	Offset     int
	Facets     bool
}

type FilePayload struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Base64   string `json:"base64"`
	Label    string `json:"label,omitempty"`
	ResumeID string `json:"resumeId,omitempty"`
	JobID    string `json:"jobId,omitempty"`
}

func newID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func trim(value string) string { return strings.TrimSpace(value) }

func ptrTime(value time.Time) *time.Time { return &value }
