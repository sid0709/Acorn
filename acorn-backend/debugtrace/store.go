package debugtrace

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	// tracesCollection holds every captured file of every tab session.
	tracesCollection = "acorn_debug_traces"
	// SessionRetention is how long a tab session's capture is kept. A report copies
	// the session onto its claim, where it stays with the claim.
	SessionRetention = 72 * time.Hour
	// saveTimeout bounds one captured file's write; capture never holds a request up.
	saveTimeout = 10 * time.Second
	// loadTimeout bounds reading one session back for a report.
	loadTimeout = 30 * time.Second
)

// File is one captured file of a tab session.
type File struct {
	// Key is whose session it is: the user and the Chrome tab (see acornapi debugKey).
	Key string
	// Run names the capture folder it belongs to (one per fill or run start).
	Run string
	// Seq orders the files within the run.
	Seq  int
	Name string
	Data []byte
	At   time.Time
}

// Store keeps captured files where a deployed server can read them back.
type Store interface {
	Save(ctx context.Context, file File) error
	// Session is every file captured for key since `since`, oldest first.
	Session(ctx context.Context, key string, since time.Time) ([]File, error)
}

// MongoStore keeps capture in MongoDB, gzipped, expiring after SessionRetention.
type MongoStore struct {
	traces *mongo.Collection
}

// NewMongoStore stores capture in db. Nil when there is no database.
func NewMongoStore(client *mongo.Client, database string) *MongoStore {
	if client == nil || database == "" {
		return nil
	}
	return &MongoStore{traces: client.Database(database).Collection(tracesCollection)}
}

type traceDoc struct {
	ID   bson.ObjectID `bson:"_id"`
	Key  string        `bson:"key"`
	Run  string        `bson:"run"`
	Seq  int           `bson:"seq"`
	Name string        `bson:"name"`
	Gzip []byte        `bson:"gzip"`
	Size int           `bson:"size"`
	At   time.Time     `bson:"at"`
}

// EnsureIndexes adds the session lookup and the expiry of old capture.
func (s *MongoStore) EnsureIndexes(ctx context.Context) error {
	if s == nil {
		return nil
	}
	_, err := s.traces.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "key", Value: 1}, {Key: "at", Value: 1}}},
		{
			Keys:    bson.D{{Key: "at", Value: 1}},
			Options: options.Index().SetExpireAfterSeconds(int32(SessionRetention / time.Second)),
		},
	})
	return err
}

// Save stores one file, compressed.
func (s *MongoStore) Save(ctx context.Context, file File) error {
	packed, err := gzipBytes(file.Data)
	if err != nil {
		return fmt.Errorf("compress %s: %w", file.Name, err)
	}
	_, err = s.traces.InsertOne(ctx, traceDoc{
		ID: bson.NewObjectID(), Key: file.Key, Run: file.Run, Seq: file.Seq, Name: file.Name,
		Gzip: packed, Size: len(file.Data), At: file.At,
	})
	return err
}

// Session reads a tab session back, oldest first.
func (s *MongoStore) Session(ctx context.Context, key string, since time.Time) ([]File, error) {
	cur, err := s.traces.Find(ctx, bson.M{"key": key, "at": bson.M{"$gte": since}},
		options.Find().SetSort(bson.D{{Key: "at", Value: 1}, {Key: "seq", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("find debug session: %w", err)
	}
	var docs []traceDoc
	if err := cur.All(ctx, &docs); err != nil {
		return nil, fmt.Errorf("read debug session: %w", err)
	}
	files := make([]File, 0, len(docs))
	for _, doc := range docs {
		data, err := gunzipBytes(doc.Gzip)
		if err != nil {
			return nil, fmt.Errorf("decompress %s: %w", doc.Name, err)
		}
		files = append(files, File{Key: doc.Key, Run: doc.Run, Seq: doc.Seq, Name: doc.Name, Data: data, At: doc.At})
	}
	return files, nil
}

func gzipBytes(data []byte) ([]byte, error) {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	if _, err := w.Write(data); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func gunzipBytes(data []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}
