package support

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"golang.org/x/sync/singleflight"
)

// previewTimeout bounds making one preview, which decodes the whole original.
const previewTimeout = 30 * time.Second

// previewFlight lets one build serve everyone who asks for the same preview: the sender's
// background build and a reader who arrives first both wait on a single decode.
var previewFlight singleflight.Group

// withoutOriginal leaves the original's bytes out of a read that only wants the preview.
var withoutOriginal = bson.M{"data": 0}

// AttachmentPreview is a small copy of one image of the claim, made on first ask when the
// send-time build has not finished (or the image predates previews). It answers false when
// the image cannot be previewed, and the caller then serves the original.
func (s *Store) AttachmentPreview(ctx context.Context, claimID, attachmentID, accountID string) (File, bool, error) {
	if !s.ready() || claimID == "" || attachmentID == "" {
		return File{}, false, mongo.ErrNoDocuments
	}
	var doc attachmentDoc
	err := s.attachments.FindOne(ctx, attachmentFilter(claimID, attachmentID, accountID),
		options.FindOne().SetProjection(withoutOriginal)).Decode(&doc)
	if err != nil {
		return File{}, false, err
	}
	if len(doc.Preview) > 0 {
		return File{MIME: doc.PreviewMIME, Data: doc.Preview}, true, nil
	}
	return s.buildPreview(ctx, "attachment:"+doc.ID, func(ctx context.Context) (Preview, bool, error) {
		return s.makeAttachmentPreview(ctx, doc.ID)
	})
}

// ScreenshotPreview is a small copy of the claim's screenshot, with the same rules as AttachmentPreview.
func (s *Store) ScreenshotPreview(ctx context.Context, claimID string) (File, bool, error) {
	if !s.ready() || claimID == "" {
		return File{}, false, mongo.ErrNoDocuments
	}
	var claim Claim
	err := s.claims.FindOne(ctx, bson.M{"_id": claimID},
		options.FindOne().SetProjection(bson.M{"screenshot": 0})).Decode(&claim)
	if err != nil {
		return File{}, false, err
	}
	if len(claim.ScreenshotPreview) > 0 {
		return File{MIME: PreviewMIME, Data: claim.ScreenshotPreview}, true, nil
	}
	return s.buildPreview(ctx, "screenshot:"+claim.ID, func(ctx context.Context) (Preview, bool, error) {
		return s.makeScreenshotPreview(ctx, claim.ID)
	})
}

func (s *Store) buildPreview(
	ctx context.Context, key string, build func(context.Context) (Preview, bool, error),
) (File, bool, error) {
	type built struct {
		preview Preview
		ok      bool
	}
	// The build outlives the request that started it: others may be waiting on the result.
	buildCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), previewTimeout)
	defer cancel()
	result, err, _ := previewFlight.Do(key, func() (any, error) {
		preview, ok, err := build(buildCtx)
		return built{preview, ok}, err
	})
	if err != nil {
		return File{}, false, fmt.Errorf("build %s preview: %w", key, err)
	}
	out := result.(built)
	return File{MIME: out.preview.MIME, Data: out.preview.Data}, out.ok, nil
}

func (s *Store) makeAttachmentPreview(ctx context.Context, id string) (Preview, bool, error) {
	var doc attachmentDoc
	err := s.attachments.FindOne(ctx, bson.M{"_id": id}, options.FindOne().SetProjection(bson.M{"preview": 0})).Decode(&doc)
	if err != nil {
		return Preview{}, false, err
	}
	preview, ok := MakePreview(ctx, doc.Data)
	if !ok {
		return Preview{}, false, nil
	}
	_, err = s.attachments.UpdateOne(ctx, bson.M{"_id": id},
		bson.M{"$set": bson.M{"preview": preview.Data, "previewMime": preview.MIME}})
	return preview, true, err
}

func (s *Store) makeScreenshotPreview(ctx context.Context, id string) (Preview, bool, error) {
	var claim Claim
	err := s.claims.FindOne(ctx, bson.M{"_id": id}, options.FindOne().SetProjection(bson.M{"screenshotPreview": 0})).Decode(&claim)
	if err != nil {
		return Preview{}, false, err
	}
	preview, ok := MakePreview(ctx, claim.Screenshot)
	if !ok {
		return Preview{}, false, nil
	}
	_, err = s.claims.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"screenshotPreview": preview.Data}})
	return preview, true, err
}

// warmAttachmentPreviews makes the previews of a message's images in the background, so they
// are stored by the time the other side opens the message. The message is already sent.
func (s *Store) warmAttachmentPreviews(claimID string, ids []string) {
	go func() {
		for _, id := range ids {
			_, _, err := s.buildPreview(context.Background(), "attachment:"+id, func(ctx context.Context) (Preview, bool, error) {
				return s.makeAttachmentPreview(ctx, id)
			})
			if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
				slog.Warn("acorn support attachment preview", "claim", claimID, "attachment", id, "error", err)
			}
		}
	}()
}

// warmScreenshotPreview makes the preview of a new claim's screenshot in the background.
func (s *Store) warmScreenshotPreview(claimID string) {
	go func() {
		_, _, err := s.buildPreview(context.Background(), "screenshot:"+claimID, func(ctx context.Context) (Preview, bool, error) {
			return s.makeScreenshotPreview(ctx, claimID)
		})
		if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
			slog.Warn("acorn support screenshot preview", "claim", claimID, "error", err)
		}
	}()
}
