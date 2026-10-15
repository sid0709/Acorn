package acornapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-backend/acornapi/gateway"
	"github.com/sid0709/acorn/acorn-backend/support"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	// messageBodyLimit fits the most images a message carries, plus its text fields.
	messageBodyLimit = support.MaxAttachments*support.MaxAttachmentBytes + 64<<10
	// messageFieldLimit bounds one text field of a multipart message.
	messageFieldLimit = support.MaxMessageLen + 1
	// immutableCacheControl: an attachment or a screenshot, and its preview, never changes once sent.
	immutableCacheControl = "private, max-age=31536000, immutable"
	// imageSizeParam picks a copy of an image, and imageSizeThumb is the small one; the same
	// strings are ATTACHMENT_SIZE in @acorn/support-chat.
	imageSizeParam = "size"
	imageSizeThumb = "thumb"

	// Multipart field names; the same strings are MESSAGE_FORM in @acorn/support-chat.
	formBody      = "body"
	formPageURL   = "pageUrl"
	formPageTitle = "pageTitle"
	formFiles     = "files"
)

var errUnreadableMessage = errors.New("could not read the message")

// addClaimMessage appends one message from the request: JSON `{ body }`, or multipart
// with body, pageUrl, pageTitle, and image files.
func (s *Server) addClaimMessage(w http.ResponseWriter, r *http.Request, claim support.Claim, author, authorName string) {
	draft, err := readDraft(w, r)
	if err != nil {
		var tooLarge *http.MaxBytesError
		switch {
		case errors.As(err, &tooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, support.ErrInvalidAttachment.Error())
		case errors.Is(err, support.ErrInvalidAttachment), errors.Is(err, support.ErrInvalidMessage):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusBadRequest, errUnreadableMessage.Error())
		}
		return
	}
	draft.Author, draft.AuthorName = author, authorName
	s.postMessage(w, r, claim, draft)
}

// postMessage stores the draft and tells both sides at once: every open support console,
// and every client of the reporter's account (their other windows included).
func (s *Server) postMessage(w http.ResponseWriter, r *http.Request, claim support.Claim, draft support.Draft) {
	msg, updated, err := s.claims.AddMessage(r.Context(), claim, draft)
	switch {
	case errors.Is(err, support.ErrInvalidMessage):
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, support.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	case err != nil:
		slog.Error("acorn support message", "error", err)
		writeError(w, http.StatusInternalServerError, "could not send the message")
		return
	}
	if draft.Author == support.AuthorUser && strings.TrimSpace(draft.PageURL) != "" {
		updated.DebugLogFiles += s.storeClaimDebugLog(r, updated.ID, updated.AccountID, msg.ID)
	}
	row := messageRow(msg)
	s.publishStaffMessage(updated, row)
	if s.sockets != nil {
		s.sockets.EmitToAccount(claim.AccountID, gateway.SupportMessageEvent, map[string]any{
			"claim": claimRow(updated, support.AuthorUser), "message": row, eventSentAt: time.Now().UnixMilli(),
		})
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": row, "claim": claimRow(updated, draft.Author)})
}

func readDraft(w http.ResponseWriter, r *http.Request) (support.Draft, error) {
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "multipart/form-data" {
		var body struct {
			Body string `json:"body"`
		}
		err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&body)
		if err != nil && !errors.Is(err, io.EOF) {
			return support.Draft{}, err
		}
		return support.Draft{Body: body.Body}, nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, messageBodyLimit)
	parts, err := r.MultipartReader()
	if err != nil {
		return support.Draft{}, err
	}
	var draft support.Draft
	for {
		part, err := parts.NextPart()
		if errors.Is(err, io.EOF) {
			return draft, nil
		}
		if err != nil {
			return support.Draft{}, err
		}
		if part.FormName() == formFiles {
			if len(draft.Uploads) == support.MaxAttachments {
				return support.Draft{}, support.ErrInvalidAttachment
			}
			data, err := io.ReadAll(io.LimitReader(part, support.MaxAttachmentBytes+1))
			if err != nil {
				return support.Draft{}, err
			}
			upload, err := support.NewUpload(part.FileName(), data)
			if err != nil {
				return support.Draft{}, err
			}
			draft.Uploads = append(draft.Uploads, upload)
			continue
		}
		data, err := io.ReadAll(io.LimitReader(part, messageFieldLimit))
		if err != nil {
			return support.Draft{}, err
		}
		if len(data) == messageFieldLimit {
			return support.Draft{}, support.ErrInvalidMessage
		}
		switch part.FormName() {
		case formBody:
			draft.Body = string(data)
		case formPageURL:
			draft.PageURL = string(data)
		case formPageTitle:
			draft.PageTitle = string(data)
		}
	}
}

// reopenMyClaim lets the reporter reopen a resolved claim; the conversation records it.
func (s *Server) reopenMyClaim(w http.ResponseWriter, r *http.Request) {
	claim, name, ok := s.myClaim(w, r)
	if !ok {
		return
	}
	if claim.Status == support.StatusOpen {
		writeJSON(w, http.StatusOK, map[string]any{"claim": claimRow(claim, support.AuthorUser)})
		return
	}
	s.postMessage(w, r, claim, support.Draft{Author: support.AuthorUser, AuthorName: name, Kind: support.KindReopened})
}

func (s *Server) myClaimAttachment(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok || !s.claimsReady(w) {
		return
	}
	s.writeAttachment(w, r, session.User.ID)
}

func (s *Server) adminClaimAttachment(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	s.writeAttachment(w, r, "")
}

// writeAttachment answers with one image of the claim in the path; accountID limits it to that
// account's. `?size=thumb` answers with the small preview when the image has one.
func (s *Server) writeAttachment(w http.ResponseWriter, r *http.Request, accountID string) {
	t := startTiming()
	claimID, attachmentID := r.PathValue("id"), r.PathValue("attachmentId")
	var (
		file support.File
		err  error
	)
	if r.URL.Query().Get(imageSizeParam) == imageSizeThumb {
		var previewed bool
		file, previewed, err = s.claims.AttachmentPreview(r.Context(), claimID, attachmentID, accountID)
		if err == nil && !previewed {
			file, err = s.claims.AttachmentFile(r.Context(), claimID, attachmentID, accountID)
		}
	} else {
		file, err = s.claims.AttachmentFile(r.Context(), claimID, attachmentID, accountID)
	}
	t.step(timingImage)
	if errors.Is(err, mongo.ErrNoDocuments) {
		writeError(w, http.StatusNotFound, "attachment not found")
		return
	}
	if err != nil {
		slog.Error("acorn support attachment", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the attachment")
		return
	}
	h := w.Header()
	h.Set("Content-Type", file.MIME)
	h.Set("Content-Length", strconv.Itoa(len(file.Data)))
	h.Set("Cache-Control", immutableCacheControl)
	h.Set("X-Content-Type-Options", "nosniff")
	t.apply(w)
	_, _ = w.Write(file.Data)
}

func messageRow(msg support.Message) map[string]any {
	attachments := make([]map[string]any, 0, len(msg.Attachments))
	for _, a := range msg.Attachments {
		attachments = append(attachments, map[string]any{
			"id": a.ID, "mime": a.MIME, "name": a.Name, "size": a.Size, "width": a.Width, "height": a.Height,
		})
	}
	return map[string]any{
		"id":          msg.ID,
		"author":      msg.Author,
		"authorName":  msg.AuthorName,
		"kind":        msg.Kind,
		"body":        msg.Body,
		"pageUrl":     msg.PageURL,
		"pageTitle":   strings.TrimSpace(msg.PageTitle),
		"attachments": attachments,
		"createdAt":   msg.CreatedAt,
	}
}
