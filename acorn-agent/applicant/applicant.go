// Package applicant reads who the agent applies as: a free-form profile.json and a
// folder of résumé files, both on this machine. There is no database.
package applicant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	// ProfileFile is the applicant's profile inside the data folder.
	ProfileFile = "profile.json"
	// ResumeDir holds the résumé files inside the data folder.
	ResumeDir = "resumes"
	// MaxProfileBytes bounds the profile the model reads on every step.
	MaxProfileBytes = 256 << 10
	// MaxResumeBytes bounds one résumé file the extension downloads.
	MaxResumeBytes = 16 << 20
)

// resumeTypes are the file kinds a résumé may be, with the type a browser sends.
var resumeTypes = map[string]string{
	".pdf":  "application/pdf",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".rtf":  "application/rtf",
	".txt":  "text/plain",
}

// ErrNoProfile is returned when the data folder has no usable profile.json.
var ErrNoProfile = errors.New("profile.json is missing or empty")

// ErrNoResume is returned for a résumé id that is not in the folder.
var ErrNoResume = errors.New("no such résumé")

// Resume is one file the agent may upload.
type Resume struct {
	// ID is the path inside the résumé folder, with slashes: "data-engineer/Robin.pdf".
	ID          string `json:"id"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	// Stack is the folder the file is in: the résumé it is one format of. A file directly in
	// the résumé folder has no stack; it is some other document (a cover letter).
	Stack string `json:"stack"`
	// Format is the file's extension without the dot, in lower case: "pdf".
	Format string `json:"format"`
}

// Snapshot is the applicant as one run sees it.
type Snapshot struct {
	// Profile is profile.json as the model reads it: indented, without the fields that are
	// hidden from it, and with each secret replaced by its placeholder.
	Profile string
	// Secrets maps each placeholder to the value the server types in its place, so the
	// model can enter a password it never sees.
	Secrets map[string]string
	// APIKey is the OpenRouter key kept in the profile, used when the server has none of its own.
	APIKey  string
	Resumes []Resume
}

// Store reads the data folder. It re-reads on every Snapshot so an edit applies to the
// next run without restarting the server.
type Store struct {
	dir    string
	hidden map[string]bool
}

// NewStore is a store over dir. hidden names the profile fields the model never sees,
// added to DefaultHiddenFields.
func NewStore(dir string, hidden ...string) *Store {
	set := map[string]bool{}
	for _, name := range append(append([]string{}, DefaultHiddenFields...), hidden...) {
		if name = strings.TrimSpace(name); name != "" {
			set[name] = true
		}
	}
	return &Store{dir: dir, hidden: set}
}

// Dir is the data folder.
func (s *Store) Dir() string { return s.dir }

// Snapshot reads profile.json and lists the résumés.
func (s *Store) Snapshot(ctx context.Context) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	profile, err := s.profile()
	if err != nil {
		return Snapshot{}, err
	}
	resumes, err := s.resumes()
	if err != nil {
		return Snapshot{}, err
	}
	profile.Resumes = resumes
	return profile, nil
}

func (s *Store) profile() (Snapshot, error) {
	path := filepath.Join(s.dir, ProfileFile)
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return Snapshot{}, fmt.Errorf("%w: put it at %s", ErrNoProfile, path)
	}
	if err != nil {
		return Snapshot{}, fmt.Errorf("read %s: %w", path, err)
	}
	if len(raw) > MaxProfileBytes {
		return Snapshot{}, fmt.Errorf("%s is larger than %d KB", ProfileFile, MaxProfileBytes>>10)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return Snapshot{}, fmt.Errorf("%w: %s", ErrNoProfile, path)
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return Snapshot{}, fmt.Errorf("%s is not valid JSON: %w", ProfileFile, err)
	}
	return s.shape(value)
}

func (s *Store) resumes() ([]Resume, error) {
	root := filepath.Join(s.dir, ResumeDir)
	if _, err := os.Stat(root); errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	var out []Resume
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			return nil
		}
		contentType, ok := resumeTypes[strings.ToLower(filepath.Ext(entry.Name()))]
		if !ok {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		id := filepath.ToSlash(rel)
		stack := ""
		if dir := filepath.ToSlash(filepath.Dir(rel)); dir != "." {
			stack = dir
		}
		out = append(out, Resume{
			ID:          id,
			FileName:    entry.Name(),
			ContentType: contentType,
			Size:        info.Size(),
			Stack:       stack,
			Format:      strings.TrimPrefix(strings.ToLower(filepath.Ext(entry.Name())), "."),
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list résumés: %w", err)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// Resume returns one résumé's description and bytes. The id is a path inside the résumé
// folder; one that climbs out of it, or names no listed file, is ErrNoResume.
func (s *Store) Resume(ctx context.Context, id string) (Resume, []byte, error) {
	if err := ctx.Err(); err != nil {
		return Resume{}, nil, err
	}
	resumes, err := s.resumes()
	if err != nil {
		return Resume{}, nil, err
	}
	for _, resume := range resumes {
		if resume.ID != id {
			continue
		}
		if resume.Size > MaxResumeBytes {
			return Resume{}, nil, fmt.Errorf("%s is larger than %d MB", id, MaxResumeBytes>>20)
		}
		data, err := os.ReadFile(filepath.Join(s.dir, ResumeDir, filepath.FromSlash(resume.ID)))
		if err != nil {
			return Resume{}, nil, fmt.Errorf("read %s: %w", id, err)
		}
		return resume, data, nil
	}
	return Resume{}, nil, fmt.Errorf("%w: %s", ErrNoResume, id)
}

// ContentType is the type a browser sends for a file name, for files the list did not type.
func ContentType(name string) string {
	if kind, ok := resumeTypes[strings.ToLower(filepath.Ext(name))]; ok {
		return kind
	}
	if kind := mime.TypeByExtension(filepath.Ext(name)); kind != "" {
		return kind
	}
	return "application/octet-stream"
}
