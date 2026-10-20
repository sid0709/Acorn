package applicant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	// applicantRoute and resumeRoute are acorn-backend's routes for the agent.
	applicantRoute = "/acorn/agent/applicant"
	resumeRoute    = "/acorn/agent/resumes/"
	// backendTimeout bounds one call to the backend.
	backendTimeout = 30 * time.Second
	// maxApplicantBytes bounds the profile and file list one run reads.
	maxApplicantBytes = 4 << 20
	// Library kinds, as the backend names them.
	kindCoverLetter = "cover_letter"
)

// Backend reads the applicant from acorn-backend with the person's own session token. It keeps
// nothing: every run asks again, so a profile edited on the website applies to the next run.
type Backend struct {
	base string
	http *http.Client
	profileShaper
}

// NewBackend is a source over acorn-backend at base (an origin, such as http://acorn-api:8083).
// hidden names more profile fields the model never sees, beside DefaultHiddenFields.
func NewBackend(base string, hidden ...string) *Backend {
	return &Backend{
		base:          strings.TrimRight(strings.TrimSpace(base), "/"),
		http:          &http.Client{Timeout: backendTimeout},
		profileShaper: newShaper(hidden),
	}
}

// Kind says the applicant is read from the backend.
func (b *Backend) Kind() string { return KindBackend }

// backendFile is one Library file as the backend names it.
type backendFile struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	FileName string `json:"fileName"`
	Format   string `json:"format"`
	MimeType string `json:"mimeType"`
	Size     int64  `json:"size"`
	Primary  bool   `json:"isPrimary"`
}

// resume maps a Library file to what the agent offers: a résumé is one format of a stack named
// by its title, as a folder is for files; a cover letter or other document stands alone.
func (f backendFile) resume() Resume {
	title := strings.TrimSpace(f.Title)
	format := strings.ToLower(strings.TrimPrefix(f.Format, "."))
	if format == "" {
		format = strings.TrimPrefix(strings.ToLower(path.Ext(f.FileName)), ".")
	}
	contentType := f.MimeType
	if contentType == "" {
		contentType = ContentType(f.FileName)
	}
	out := Resume{ID: f.ID, FileName: f.FileName, ContentType: contentType, Size: f.Size, Format: format}
	if f.Kind == kindCoverLetter {
		out.Name = title
		return out
	}
	out.Stack = title
	out.Primary = f.Primary
	return out
}

// SnapshotFor asks the backend for the person's profile and files.
func (b *Backend) SnapshotFor(ctx context.Context, auth Auth) (Snapshot, error) {
	var body struct {
		Profile json.RawMessage `json:"profile"`
		Files   []backendFile   `json:"files"`
	}
	raw, err := b.get(ctx, auth, applicantRoute, maxApplicantBytes)
	if err != nil {
		return Snapshot{}, err
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return Snapshot{}, fmt.Errorf("%w: the applicant answer is not JSON: %v", ErrBackend, err)
	}
	if len(body.Profile) == 0 || string(body.Profile) == "null" {
		return Snapshot{}, fmt.Errorf("%w: save your profile on the Acorn website first", ErrNoProfile)
	}
	var profile any
	if err := json.Unmarshal(body.Profile, &profile); err != nil {
		return Snapshot{}, fmt.Errorf("%w: the profile is not JSON: %v", ErrBackend, err)
	}
	if len(body.Profile) > MaxProfileBytes {
		return Snapshot{}, fmt.Errorf("the profile is larger than %d KB", MaxProfileBytes>>10)
	}
	snapshot, err := b.shape(profile)
	if err != nil {
		return Snapshot{}, err
	}
	for _, file := range body.Files {
		if file.ID != "" && file.FileName != "" && strings.TrimSpace(file.Title) != "" {
			snapshot.Resumes = append(snapshot.Resumes, file.resume())
		}
	}
	sort.SliceStable(snapshot.Resumes, func(i, j int) bool { return snapshot.Resumes[i].ID < snapshot.Resumes[j].ID })
	return snapshot, nil
}

// ResumeFor fetches one file's bytes. Its description comes from the answer's headers; the
// stack it belongs to is not needed to send it.
func (b *Backend) ResumeFor(ctx context.Context, auth Auth, id string) (Resume, []byte, error) {
	asked := time.Now()
	response, err := b.do(ctx, auth, resumeRoute+url.PathEscape(id))
	if err != nil {
		return Resume{}, nil, err
	}
	defer response.Body.Close()
	wait := time.Since(asked)
	if response.StatusCode == http.StatusNotFound {
		return Resume{}, nil, fmt.Errorf("%w: %s", ErrNoResume, id)
	}
	if err := statusError(response); err != nil {
		return Resume{}, nil, err
	}
	if size := declaredSize(response); size > MaxResumeBytes {
		return Resume{}, nil, fmt.Errorf("%s is larger than %d MB", id, MaxResumeBytes>>20)
	}
	reading := time.Now()
	data, err := io.ReadAll(io.LimitReader(response.Body, MaxResumeBytes+1))
	if err != nil {
		return Resume{}, nil, fmt.Errorf("%w: read the file: %v", ErrBackend, err)
	}
	record(ctx, wait, time.Since(reading), len(data), response.Header.Get(ServerTimingHeader))
	if len(data) > MaxResumeBytes {
		return Resume{}, nil, fmt.Errorf("%s is larger than %d MB", id, MaxResumeBytes>>20)
	}
	name := response.Header.Get("X-File-Name")
	contentType := response.Header.Get("Content-Type")
	if name == "" {
		name = id
	}
	return Resume{
		ID: id, FileName: name, ContentType: contentType, Size: int64(len(data)),
		Format: strings.TrimPrefix(strings.ToLower(path.Ext(name)), "."),
	}, data, nil
}

func declaredSize(response *http.Response) int64 {
	size, err := strconv.ParseInt(response.Header.Get("Content-Length"), 10, 64)
	if err != nil {
		return -1
	}
	return size
}

// get reads a JSON answer, bounded.
func (b *Backend) get(ctx context.Context, auth Auth, route string, limit int64) ([]byte, error) {
	asked := time.Now()
	response, err := b.do(ctx, auth, route)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	wait := time.Since(asked)
	if err := statusError(response); err != nil {
		return nil, err
	}
	reading := time.Now()
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("%w: read the answer: %v", ErrBackend, err)
	}
	record(ctx, wait, time.Since(reading), len(raw), response.Header.Get(ServerTimingHeader))
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("%w: the answer is larger than %d MB", ErrBackend, limit>>20)
	}
	return raw, nil
}

func (b *Backend) do(ctx context.Context, auth Auth, route string) (*http.Response, error) {
	if strings.TrimSpace(auth.Token) == "" {
		return nil, ErrSignedOut
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, b.base+route, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build the request: %v", ErrBackend, err)
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(auth.Token))
	request.Header.Set("Accept", "application/json, */*")
	response, err := b.http.Do(request)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %v", ErrBackend, err)
	}
	return response, nil
}

// statusError turns the backend's refusal into an error a caller can tell apart.
func statusError(response *http.Response) error {
	switch {
	case response.StatusCode == http.StatusUnauthorized:
		return ErrSignedOut
	case response.StatusCode < 200 || response.StatusCode >= 300:
		return fmt.Errorf("%w: it answered %d", ErrBackend, response.StatusCode)
	}
	return nil
}
