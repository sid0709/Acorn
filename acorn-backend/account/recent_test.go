package account

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// testMongoURI names a throwaway MongoDB the test may create a database in and drop again, such as
// a local mongod. Without it the test is skipped.
const testMongoURI = "ACORN_TEST_MONGO_URI"

func TestRecentUserIDsAreTheValidSignInsNewestFirstOncePerAccount(t *testing.T) {
	uri := os.Getenv(testMongoURI)
	if uri == "" {
		t.Skipf("set %s to a throwaway MongoDB to run this test", testMongoURI)
	}
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("acorn_recent_test_%d", time.Now().UnixNano())
	defer func() {
		_ = client.Database(name).Drop(context.Background())
		_ = client.Disconnect(context.Background())
	}()
	store := NewStore(client, name)
	now := time.Now().UTC()
	rows := []any{
		storedSession{TokenHash: "1", UserID: "old", ExpiresAt: now.Add(time.Hour), CreatedAt: now.Add(-3 * time.Hour)},
		storedSession{TokenHash: "2", UserID: "new", ExpiresAt: now.Add(time.Hour), CreatedAt: now.Add(-time.Minute)},
		storedSession{TokenHash: "3", UserID: "old", ExpiresAt: now.Add(time.Hour), CreatedAt: now.Add(-2 * time.Hour)},
		storedSession{TokenHash: "4", UserID: "gone", ExpiresAt: now.Add(-time.Hour), CreatedAt: now.Add(-time.Second)},
	}
	if _, err := store.sessions.InsertMany(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	got, err := store.RecentUserIDs(context.Background(), now, 10)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"new", "old"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("recent = %v, want %v", got, want)
	}
	if one, _ := store.RecentUserIDs(context.Background(), now, 1); len(one) != 1 || one[0] != "new" {
		t.Fatalf("limit 1 = %v", one)
	}
}
