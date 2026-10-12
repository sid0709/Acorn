package support

import (
	"context"
	"log/slog"
	"path"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const debugLogsCollection = "acorn_support_debug_logs"

const (
	// MaxDebugFileBytes is the largest one debug-run file stored on a report.
	// It stays under MongoDB's 16MB document limit.
	MaxDebugFileBytes = 12 << 20
	// MaxDebugLogBytes is the most one report stores across its debug-run files.
	MaxDebugLogBytes = 64 << 20
	// maxDebugNameLen bounds a stored debug-run file name.
	maxDebugNameLen = 200
)

// DebugBlob is one file from a debug run, before it is stored on a report.
type DebugBlob struct {
	Name string
	Data []byte
}

// DebugFile is one stored debug-run file. MessageID is empty for the opening report.
type DebugFile struct {
	ID        string    `bson:"_id"`
	ClaimID   string    `bson:"claimId"`
	MessageID string    `bson:"messageId,omitempty"`
	Name      string    `bson:"name"`
	Data      []byte    `bson:"data"`
	CreatedAt time.Time `bson:"createdAt"`
}

// SaveDebugLog stores a debug run's files on a claim. messageID is empty for the
// opening report and set when a follow-up adds another copy. It returns how many
// files this call stored. Text files are kept ahead of screenshots when the run
// is larger than MaxDebugLogBytes.
func (s *Store) SaveDebugLog(ctx context.Context, claimID, messageID string, blobs []DebugBlob) (int, error) {
	if !s.ready() || s.debugLogs == nil || claimID == "" || len(blobs) == 0 {
		return 0, nil
	}
	kept := keepDebugBlobs(blobs)
	if len(kept) == 0 {
		return 0, nil
	}
	now := time.Now().UTC()
	docs := make([]any, 0, len(kept))
	ids := make([]string, 0, len(kept))
	for _, blob := range kept {
		id := bson.NewObjectID().Hex()
		ids = append(ids, id)
		docs = append(docs, DebugFile{
			ID: id, ClaimID: claimID, MessageID: messageID, Name: blob.Name, Data: blob.Data, CreatedAt: now,
		})
	}
	if _, err := s.debugLogs.InsertMany(ctx, docs); err != nil {
		_, _ = s.debugLogs.DeleteMany(ctx, bson.M{"_id": bson.M{"$in": ids}})
		return 0, err
	}
	stored, err := s.debugLogs.CountDocuments(ctx, bson.M{"claimId": claimID})
	if err != nil {
		return len(docs), err
	}
	if _, err := s.claims.UpdateOne(ctx, bson.M{"_id": claimID}, bson.M{
		"$set": bson.M{"debugLogFiles": stored},
	}); err != nil {
		slog.Error("acorn support debug log count", "error", err, "claimId", claimID)
	}
	return len(docs), nil
}

// DebugLog loads every debug-run file stored for a claim, report files first.
func (s *Store) DebugLog(ctx context.Context, claimID string) ([]DebugFile, error) {
	if !s.ready() || s.debugLogs == nil || claimID == "" {
		return nil, nil
	}
	cursor, err := s.debugLogs.Find(ctx, bson.M{"claimId": claimID}, options.Find().
		SetSort(bson.D{{Key: "messageId", Value: 1}, {Key: "name", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	rows := []DebugFile{}
	err = cursor.All(ctx, &rows)
	return rows, err
}

// keepDebugBlobs drops unsafe, empty, and oversized files, then stops at MaxDebugLogBytes.
func keepDebugBlobs(blobs []DebugBlob) []DebugBlob {
	kept := make([]DebugBlob, 0, len(blobs))
	seen := map[string]bool{}
	for _, blob := range blobs {
		name := cleanDebugName(blob.Name)
		if name == "" || seen[name] || len(blob.Data) == 0 || len(blob.Data) > MaxDebugFileBytes {
			continue
		}
		seen[name] = true
		kept = append(kept, DebugBlob{Name: name, Data: blob.Data})
	}
	sort.Slice(kept, func(i, j int) bool {
		if debugImage(kept[i].Name) != debugImage(kept[j].Name) {
			return !debugImage(kept[i].Name)
		}
		return kept[i].Name < kept[j].Name
	})
	total := 0
	out := make([]DebugBlob, 0, len(kept))
	for _, blob := range kept {
		if total+len(blob.Data) > MaxDebugLogBytes {
			slog.Warn("acorn support debug log truncated", "file", blob.Name, "bytes", len(blob.Data))
			continue
		}
		total += len(blob.Data)
		out = append(out, blob)
	}
	return out
}

func cleanDebugName(name string) string {
	name = path.Base(strings.ReplaceAll(strings.TrimSpace(name), "\\", "/"))
	if name == "" || name == "." || name == ".." || strings.Contains(name, "/") {
		return ""
	}
	if len(name) > maxDebugNameLen {
		return ""
	}
	return name
}

func debugImage(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}
