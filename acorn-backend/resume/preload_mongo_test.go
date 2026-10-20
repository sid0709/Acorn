package resume

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// testMongoURI names a throwaway MongoDB the test may create a database in and drop again, such as
// a local mongod. Without it these tests are skipped.
const testMongoURI = "ACORN_TEST_MONGO_URI"

func tempStore(t *testing.T) *Store {
	t.Helper()
	uri := os.Getenv(testMongoURI)
	if uri == "" {
		t.Skipf("set %s to a throwaway MongoDB to run this test", testMongoURI)
	}
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("acorn_preload_test_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_ = client.Database(name).Drop(context.Background())
		_ = client.Disconnect(context.Background())
	})
	return NewStore(client, name)
}

func TestPreloadReadsEveryAccountsFilesIntoMemory(t *testing.T) {
	store := tempStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	rows := []LibraryRow{
		{ID: "a1", AccountID: "alice", Title: "Go", FileName: "go.pdf", Size: 5, UploadedAt: now, Bytes: []byte("alice")},
		{ID: "a2", AccountID: "alice", Title: "Go", FileName: "go.docx", Size: 6, UploadedAt: now, Bytes: []byte("alice2")},
		{ID: "b1", AccountID: "bob", Title: "Java", FileName: "java.pdf", Size: 3, UploadedAt: now.Add(-time.Hour), Bytes: []byte("bob")},
	}
	for _, row := range rows {
		if err := store.putLibrary(row); err != nil {
			t.Fatal(err)
		}
	}
	// A server that starts later has nothing in memory.
	fresh := NewStore(nil, "")
	fresh.db = store.db
	fresh.SetCache(1<<20, 0)

	report := fresh.Preload(ctx, []string{"bob"})
	if report.Accounts != 2 || report.Files != 3 || report.Bytes != 14 || report.Skipped != 0 {
		t.Fatalf("report = %+v", report)
	}
	for _, row := range rows {
		cached, fresh := fresh.files.get(fileKey(row.AccountID, row.ID))
		if cached == nil || !fresh || string(cached.row.Bytes) != string(row.Bytes) {
			t.Fatalf("%s must be held with its bytes: %+v", row.ID, cached)
		}
	}
	// The stack of alice's Go résumé now comes from memory: the database is gone and it still answers.
	if err := fresh.db.Drop(ctx); err != nil {
		t.Fatal(err)
	}
	payload, _, err := (&Service{store: fresh}).LibraryFileVersioned("alice", "a2")
	if err != nil || len(payload.Variants) != 1 {
		t.Fatalf("payload = %+v, err = %v", payload.Name, err)
	}
}

func TestPreloadStopsAtTheCap(t *testing.T) {
	store := tempStore(t)
	now := time.Now().UTC()
	for _, row := range []LibraryRow{
		{ID: "a1", AccountID: "alice", Title: "Go", FileName: "go.pdf", Size: 8, UploadedAt: now, Bytes: []byte("12345678")},
		{ID: "b1", AccountID: "bob", Title: "Java", FileName: "java.pdf", Size: 8, UploadedAt: now.Add(-time.Hour), Bytes: []byte("abcdefgh")},
	} {
		if err := store.putLibrary(row); err != nil {
			t.Fatal(err)
		}
	}
	fresh := NewStore(nil, "")
	fresh.db = store.db
	fresh.SetCache(10, 0)
	report := fresh.Preload(context.Background(), nil)
	if report.Accounts != 1 || report.Skipped != 1 {
		t.Fatalf("report = %+v: the second account would pass the cap", report)
	}
}
