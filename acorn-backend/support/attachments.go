package support

import (
	"bytes"
	"context"
	"image"
	_ "image/gif"  // DecodeConfig reads GIF sizes.
	_ "image/jpeg" // DecodeConfig reads JPEG sizes.
	_ "image/png"  // DecodeConfig reads PNG sizes.
	"net/http"
	"path"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	attachmentsCollection = "acorn_support_attachments"

	// MaxAttachmentBytes is the largest image a message carries: a full-page screenshot fits.
	MaxAttachmentBytes = MaxScreenshotBytes
	// MaxAttachments is how many images one message carries.
	MaxAttachments = 4
	// maxAttachmentNameLen bounds a stored file name.
	maxAttachmentNameLen = 200
	// maxUploadsPerWindow bounds a reporter's images per rate-limit window.
	maxUploadsPerWindow = 40
)

// attachmentTypes are the images a message may carry, by sniffed content type.
var attachmentTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
}

// Attachment is an image on a message, as the conversation lists it; the bytes are fetched apart.
type Attachment struct {
	ID     string `bson:"id"`
	MIME   string `bson:"mime"`
	Name   string `bson:"name"`
	Size   int    `bson:"size"`
	Width  int    `bson:"width,omitempty"`
	Height int    `bson:"height,omitempty"`
}

// Upload is one image on its way into a message.
type Upload struct {
	Name   string
	MIME   string
	Data   []byte
	Width  int
	Height int
}

// NewUpload checks an image's size and real type (never the name or a declared type) and
// reads its dimensions when the format allows.
func NewUpload(name string, data []byte) (Upload, error) {
	if len(data) == 0 || len(data) > MaxAttachmentBytes {
		return Upload{}, ErrInvalidAttachment
	}
	mime := http.DetectContentType(data)
	if !attachmentTypes[mime] {
		return Upload{}, ErrInvalidAttachment
	}
	upload := Upload{Name: cleanName(name), MIME: mime, Data: data}
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		upload.Width, upload.Height = cfg.Width, cfg.Height
	}
	return upload, nil
}

func cleanName(name string) string {
	name = strings.TrimSpace(path.Base(strings.ReplaceAll(name, "\\", "/")))
	if name == "." || name == "/" {
		return ""
	}
	if len(name) > maxAttachmentNameLen {
		name = name[:maxAttachmentNameLen]
	}
	return name
}

// attachmentDoc is an image's bytes, kept apart from the message so threads stay small.
type attachmentDoc struct {
	ID        string    `bson:"_id"`
	ClaimID   string    `bson:"claimId"`
	AccountID string    `bson:"accountId"`
	MessageID string    `bson:"messageId"`
	Author    string    `bson:"author"`
	MIME      string    `bson:"mime"`
	Data      []byte    `bson:"data"`
	CreatedAt time.Time `bson:"createdAt"`
	// Preview is a small copy of Data, made once after the message is sent; see previews.go.
	Preview     []byte `bson:"preview,omitempty"`
	PreviewMIME string `bson:"previewMime,omitempty"`
}

// File is an attachment's bytes and type, for serving.
type File struct {
	MIME string
	Data []byte
}

// AttachmentFile loads one image of the claim. With accountID set, the claim must be that account's.
func (s *Store) AttachmentFile(ctx context.Context, claimID, attachmentID, accountID string) (File, error) {
	if !s.ready() || claimID == "" || attachmentID == "" {
		return File{}, mongo.ErrNoDocuments
	}
	var doc attachmentDoc
	if err := s.attachments.FindOne(ctx, attachmentFilter(claimID, attachmentID, accountID)).Decode(&doc); err != nil {
		return File{}, err
	}
	return File{MIME: doc.MIME, Data: doc.Data}, nil
}

// attachmentFilter matches one image of the claim; accountID, when set, limits it to that account's.
func attachmentFilter(claimID, attachmentID, accountID string) bson.M {
	filter := bson.M{"_id": attachmentID, "claimId": claimID}
	if accountID != "" {
		filter["accountId"] = accountID
	}
	return filter
}

// storeUploads saves a message's images and returns how the message lists them.
func (s *Store) storeUploads(ctx context.Context, msg Message, uploads []Upload) ([]Attachment, error) {
	if len(uploads) == 0 {
		return nil, nil
	}
	docs := make([]any, 0, len(uploads))
	listed := make([]Attachment, 0, len(uploads))
	for _, upload := range uploads {
		id := bson.NewObjectID().Hex()
		docs = append(docs, attachmentDoc{
			ID: id, ClaimID: msg.ClaimID, AccountID: msg.AccountID, MessageID: msg.ID,
			Author: msg.Author, MIME: upload.MIME, Data: upload.Data, CreatedAt: msg.CreatedAt,
		})
		listed = append(listed, Attachment{
			ID: id, MIME: upload.MIME, Name: upload.Name, Size: len(upload.Data),
			Width: upload.Width, Height: upload.Height,
		})
	}
	if _, err := s.attachments.InsertMany(ctx, docs); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(listed))
	for _, a := range listed {
		ids = append(ids, a.ID)
	}
	s.warmAttachmentPreviews(msg.ClaimID, ids)
	return listed, nil
}

func (s *Store) dropUploads(ctx context.Context, messageID string) {
	_, _ = s.attachments.DeleteMany(ctx, bson.M{"messageId": messageID})
}
