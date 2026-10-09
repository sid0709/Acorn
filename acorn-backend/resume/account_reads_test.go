package resume

import "testing"

func TestAccountReadsForgetOnlyThatAccount(t *testing.T) {
	var reads accountReads
	reads.put(libraryCollection, "a", []LibraryRow{{ID: "1"}})
	reads.put(configsCollection, "a", map[string]any{"k": "v"})
	reads.put(libraryCollection, "ba", []LibraryRow{{ID: "2"}})

	reads.forget(configsCollection, "a")
	if _, ok := reads.get(configsCollection, "a"); ok {
		t.Fatal("a write must drop that collection's copy")
	}
	if _, ok := reads.get(libraryCollection, "a"); !ok {
		t.Fatal("another collection's copy must stay")
	}

	reads.forgetAccount("a")
	if _, ok := reads.get(libraryCollection, "a"); ok {
		t.Fatal("deleting the account must drop all its copies")
	}
	if _, ok := reads.get(libraryCollection, "ba"); !ok {
		t.Fatal("an account whose id merely ends the same must keep its copy")
	}
}
