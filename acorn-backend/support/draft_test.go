package support

import (
	"bytes"
	"image"
	"image/png"
	"strings"
	"testing"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestDraftCleanAcceptsTextImagesOrAPage(t *testing.T) {
	upload := Upload{MIME: "image/png", Data: []byte{1}}
	for name, draft := range map[string]Draft{
		"text":       {Author: AuthorUser, Body: "  still broken  "},
		"image only": {Author: AuthorAdmin, Uploads: []Upload{upload}},
		"page only":  {Author: AuthorUser, PageURL: "https://jobs.example/apply"},
		"reopened":   {Author: AuthorUser, Kind: KindReopened},
		"resolved":   {Author: AuthorAdmin, Kind: KindResolved},
	} {
		if _, ok := draft.Clean(); !ok {
			t.Errorf("%s: rejected", name)
		}
	}
	got, _ := Draft{Author: AuthorUser, Body: "  still broken  "}.Clean()
	if got.Body != "still broken" {
		t.Errorf("body = %q, want trimmed", got.Body)
	}
}

func TestDraftCleanRejects(t *testing.T) {
	five := make([]Upload, MaxAttachments+1)
	for name, draft := range map[string]Draft{
		"empty":             {Author: AuthorUser, Body: "   "},
		"no author":         {Body: "hi"},
		"user resolves":     {Author: AuthorUser, Kind: KindResolved},
		"unknown kind":      {Author: AuthorAdmin, Kind: "deleted"},
		"event with text":   {Author: AuthorUser, Kind: KindReopened, Body: "hi"},
		"too long":          {Author: AuthorUser, Body: strings.Repeat("a", MaxMessageLen+1)},
		"too many images":   {Author: AuthorUser, Uploads: five},
		"page URL too long": {Author: AuthorUser, PageURL: strings.Repeat("a", MaxPageURLLen+1)},
	} {
		if _, ok := draft.Clean(); ok {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestDraftStatusAfter(t *testing.T) {
	cases := []struct {
		draft Draft
		want  string
	}{
		{Draft{Author: AuthorUser, Body: "hi"}, StatusOpen},
		{Draft{Author: AuthorAdmin, Body: "hi"}, ""},
		{Draft{Author: AuthorAdmin, Kind: KindResolved}, StatusClosed},
		{Draft{Author: AuthorAdmin, Kind: KindReopened}, StatusOpen},
	}
	for _, c := range cases {
		if got := c.draft.statusAfter(); got != c.want {
			t.Errorf("%+v: status = %q, want %q", c.draft, got, c.want)
		}
	}
}

func TestNewUploadSniffsTypeAndSize(t *testing.T) {
	upload, err := NewUpload(`C:\Users\me\shot.png`, pngBytes(t, 40, 30))
	if err != nil {
		t.Fatal(err)
	}
	if upload.MIME != "image/png" || upload.Width != 40 || upload.Height != 30 || upload.Name != "shot.png" {
		t.Fatalf("upload = %+v", upload)
	}
}

func TestNewUploadRejectsNonImagesAndOversize(t *testing.T) {
	for name, data := range map[string][]byte{
		"empty":    nil,
		"html":     []byte("<html><script>alert(1)</script></html>"),
		"oversize": append(pngBytes(t, 1, 1), make([]byte, MaxAttachmentBytes)...),
	} {
		if _, err := NewUpload("x.png", data); err != ErrInvalidAttachment {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}
