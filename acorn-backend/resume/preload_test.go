package resume

import (
	"reflect"
	"testing"
)

func ids(plan []accountSize) []string {
	out := make([]string, len(plan))
	for i, account := range plan {
		out[i] = account.ID
	}
	return out
}

func TestPlanPreloadLoadsTheNamedAccountsFirstThenTheRestInOrder(t *testing.T) {
	all := []accountSize{{"new", 2, 10}, {"mid", 2, 10}, {"old", 2, 10}}
	plan, skipped := planPreload(all, []string{"old", "unknown", "old"}, 1000)
	if want := []string{"old", "new", "mid"}; !reflect.DeepEqual(ids(plan), want) || skipped != 0 {
		t.Fatalf("plan = %v skipped = %d, want %v", ids(plan), skipped, want)
	}
}

func TestPlanPreloadStopsAtTheBudgetAndSkipsEmptyAccounts(t *testing.T) {
	all := []accountSize{{"a", 3, 60}, {"empty", 0, 0}, {"big", 5, 100}, {"b", 1, 30}}
	plan, skipped := planPreload(all, nil, 100)
	if want := []string{"a", "b"}; !reflect.DeepEqual(ids(plan), want) {
		t.Fatalf("plan = %v, want %v", ids(plan), want)
	}
	if skipped != 1 {
		t.Fatalf("skipped = %d: only the account that would pass the budget counts", skipped)
	}
}

func TestIngestAccountKeepsFilesWithBytesAndTheListWithout(t *testing.T) {
	store := NewMemory()
	rows := []LibraryRow{
		{ID: "1", AccountID: "acct", FileName: "a.pdf", ExtractedText: "text", Bytes: []byte("pdf")},
		{ID: "2", AccountID: "acct", FileName: "b.docx", Bytes: []byte("docx!")},
		{ID: "3", AccountID: "acct", FileName: "empty.txt"},
	}
	files, bytes := store.ingestAccount("acct", rows)
	if files != 2 || bytes != 8 {
		t.Fatalf("loaded %d files, %d bytes", files, bytes)
	}
	copy, fresh := store.files.get(fileKey("acct", "1"))
	if copy == nil || !fresh || string(copy.row.Bytes) != "pdf" {
		t.Fatalf("a loaded file must be held with its bytes and trusted: %+v fresh=%v", copy, fresh)
	}
	list, ok := store.reads.get(libraryCollection, "acct")
	if !ok {
		t.Fatalf("the account's list must be held")
	}
	held := list.([]LibraryRow)
	if len(held) != 3 {
		t.Fatalf("list has %d rows", len(held))
	}
	for _, row := range held {
		if row.Bytes != nil {
			t.Fatalf("the list must not carry bytes: %+v", row)
		}
	}
	if held[0].ExtractedText != "text" {
		t.Fatalf("the list keeps the row's other fields")
	}
}

func TestEveryChangeToALibraryIsCounted(t *testing.T) {
	store := NewMemory()
	before := store.libraryGeneration("acct")
	if err := store.putLibrary(LibraryRow{ID: "1", AccountID: "acct", Bytes: []byte("x")}); err != nil {
		t.Fatal(err)
	}
	afterPut := store.libraryGeneration("acct")
	store.deleteLibrary("acct", "1")
	if !(afterPut > before && store.libraryGeneration("acct") > afterPut) {
		t.Fatalf("generations %d, %d, %d: a read begun before a change must be told it is old", before, afterPut, store.libraryGeneration("acct"))
	}
	if store.libraryGeneration("other") != 0 {
		t.Fatalf("another account's Library is unchanged")
	}
}

func TestSetCacheSetsTheCapAndTheWindow(t *testing.T) {
	store := NewMemory()
	store.SetCache(1<<20, 0)
	if store.files.limit() != 1<<20 {
		t.Fatalf("limit = %d", store.files.limit())
	}
	if store.files.trust != 0 {
		t.Fatalf("a trust of zero keeps a copy until a write changes it")
	}
	if files, _ := store.files.usage(); files != 0 {
		t.Fatalf("nothing is held yet")
	}
}
