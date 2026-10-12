package acornapi

import (
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/support"
)

// A claim's captured session keeps its run folders in the download, and no stored
// name climbs out of the report's folder.
func TestDebugZipPathKeepsRunFolders(t *testing.T) {
	cases := []struct {
		file support.DebugFile
		want string
	}{
		{support.DebugFile{Name: "20261012-022021-no-analyze/04-read-page.json"}, "report/20261012-022021-no-analyze/04-read-page.json"},
		{support.DebugFile{Name: "../../etc/passwd", MessageID: "m1"}, "follow-up-m1/etc/passwd"},
		{support.DebugFile{Name: "steps.ndjson"}, "report/steps.ndjson"},
		{support.DebugFile{Name: "/"}, "report/file"},
	}
	for _, c := range cases {
		if got := debugZipPath(c.file); got != c.want {
			t.Errorf("debugZipPath(%q) = %q, want %q", c.file.Name, got, c.want)
		}
	}
}
