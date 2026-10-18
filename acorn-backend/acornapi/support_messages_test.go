package acornapi

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-backend/support"
)

func multipartRequest(t *testing.T, fields map[string]string, files int) *http.Request {
	t.Helper()
	var shot bytes.Buffer
	if err := png.Encode(&shot, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for name, value := range fields {
		_ = form.WriteField(name, value)
	}
	for range files {
		part, _ := form.CreateFormFile(formFiles, "shot.png")
		_, _ = part.Write(shot.Bytes())
	}
	_ = form.Close()
	r := httptest.NewRequest(http.MethodPost, "/acorn/support/claims/c1/messages", &body)
	r.Header.Set("Content-Type", form.FormDataContentType())
	return r
}

func TestReadDraftReadsMultipartFieldsAndImages(t *testing.T) {
	r := multipartRequest(t, map[string]string{
		formBody: "Happened again", formPageURL: "https://jobs.example/apply", formPageTitle: "Apply",
	}, 2)
	draft, err := readDraft(httptest.NewRecorder(), r)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Body != "Happened again" || draft.PageURL != "https://jobs.example/apply" ||
		draft.PageTitle != "Apply" || len(draft.Uploads) != 2 || draft.Uploads[0].MIME != "image/png" {
		t.Fatalf("draft = %+v", draft)
	}
}

func TestReadDraftStillReadsJSON(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"body":"hi"}`))
	r.Header.Set("Content-Type", "application/json")
	draft, err := readDraft(httptest.NewRecorder(), r)
	if err != nil || draft.Body != "hi" {
		t.Fatalf("draft = %+v, err = %v", draft, err)
	}
}

func TestReadDraftRejectsTooManyImages(t *testing.T) {
	r := multipartRequest(t, nil, support.MaxAttachments+1)
	if _, err := readDraft(httptest.NewRecorder(), r); !errors.Is(err, support.ErrInvalidAttachment) {
		t.Fatalf("err = %v, want ErrInvalidAttachment", err)
	}
}

func TestMessageRowListsAttachments(t *testing.T) {
	row := messageRow(support.Message{
		ID: "m1", Kind: support.KindReopened,
		Attachments: []support.Attachment{{ID: "a1", MIME: "image/png", Size: 10}},
	})
	list := row["attachments"].([]map[string]any)
	if row["kind"] != support.KindReopened || len(list) != 1 || list[0]["id"] != "a1" {
		t.Fatalf("row = %+v", row)
	}
}
