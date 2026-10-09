package resume

import (
	"encoding/base64"
	"path/filepath"
	"sort"
	"strings"
)

// Library kinds. A row with no kind is a résumé: every row saved before kinds existed is one.
const (
	KindResume      = "resume"
	KindCoverLetter = "cover_letter"
)

// IsLibraryKind says whether kind is one the Library keeps.
func IsLibraryKind(kind string) bool {
	return kind == KindResume || kind == KindCoverLetter
}

// rowKind is the row's kind, a résumé when it has none.
func rowKind(row LibraryRow) string {
	if row.Kind == KindCoverLetter {
		return KindCoverLetter
	}
	return KindResume
}

// File formats a Library file can be, by its extension.
const (
	FormatPDF  = "pdf"
	FormatDOCX = "docx"
	FormatDOC  = "doc"
	FormatTXT  = "txt"
)

// formatPreference is the order a stack's files are offered in: a PDF looks the
// same on every site, so it is sent unless the upload field asks for another.
var formatPreference = []string{FormatPDF, FormatDOCX, FormatDOC, FormatTXT}

// fileFormat is a file's format by its extension; "" when it is none the Library knows.
func fileFormat(name string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	for _, format := range formatPreference {
		if ext == format {
			return format
		}
	}
	return ""
}

// formatRank orders formats by formatPreference; unknown ones last.
func formatRank(name string) int {
	format := fileFormat(name)
	for i, preferred := range formatPreference {
		if format == preferred {
			return i
		}
	}
	return len(formatPreference)
}

// stackKey names a stack: rows of one kind whose titles match, whatever their case
// and spacing, are versions of one document in different formats.
func stackKey(row LibraryRow) string {
	return rowKind(row) + "|" + strings.ToLower(strings.Join(strings.Fields(row.Title), " "))
}

// isUploaded says whether the applicant uploaded the row (not the generator).
func isUploaded(row LibraryRow) bool {
	return row.Source == "" || row.Source == "uploaded"
}

// LibraryStack is one stack of a kind: its versions, preferred format first.
type LibraryStack struct {
	Title string
	Kind  string
	Rows  []LibraryRow
}

// Lead is the row that stands for the stack: an analyzed one in the preferred
// format, so a match reads the stack's skills.
func (s LibraryStack) Lead() LibraryRow {
	for _, row := range s.Rows {
		if row.Analyzed && len(row.SkillProfile) > 0 {
			return row
		}
	}
	return s.Rows[0]
}

// IsPrimary says whether any version of the stack is the applicant's primary.
func (s LibraryStack) IsPrimary() bool {
	for _, row := range s.Rows {
		if row.IsPrimary {
			return true
		}
	}
	return false
}

// stacksOf groups uploaded rows of one kind into stacks, each sorted by format
// preference, in the order their first row appears.
func stacksOf(rows []LibraryRow, kind string) []LibraryStack {
	byKey := map[string]int{}
	var stacks []LibraryStack
	for _, row := range rows {
		if !isUploaded(row) || rowKind(row) != kind {
			continue
		}
		key := stackKey(row)
		i, seen := byKey[key]
		if !seen {
			i = len(stacks)
			byKey[key] = i
			stacks = append(stacks, LibraryStack{Title: strings.TrimSpace(row.Title), Kind: kind})
		}
		stacks[i].Rows = append(stacks[i].Rows, row)
	}
	for i := range stacks {
		sort.SliceStable(stacks[i].Rows, func(a, b int) bool {
			return formatRank(stacks[i].Rows[a].FileName) < formatRank(stacks[i].Rows[b].FileName)
		})
	}
	return stacks
}

// stackOf is the stack the row belongs to, with every version's bytes loaded.
func (s *Service) stackOf(accountID string, row LibraryRow) []LibraryRow {
	if !isUploaded(row) {
		return []LibraryRow{row}
	}
	key := stackKey(row)
	var out []LibraryRow
	for _, sibling := range s.store.listLibrary(accountID) {
		if !isUploaded(sibling) || stackKey(sibling) != key {
			continue
		}
		if full, ok := s.store.libraryItem(accountID, sibling.ID); ok && len(full.Bytes) > 0 {
			out = append(out, full)
		}
	}
	if len(out) == 0 {
		return []LibraryRow{row}
	}
	sort.SliceStable(out, func(a, b int) bool { return formatRank(out[a].FileName) < formatRank(out[b].FileName) })
	return out
}

// filePayload is one Library file as the extension attaches it.
func filePayload(key string, row LibraryRow) FilePayload {
	return FilePayload{
		Key: key, Name: row.FileName, MimeType: row.MimeType,
		Base64: base64.StdEncoding.EncodeToString(row.Bytes), Label: row.Title,
		ResumeID: row.ID, JobID: row.JobID, Format: fileFormat(row.FileName), Kind: rowKind(row),
	}
}

// stackPayload is a stack's preferred file with every other version alongside,
// so an upload field that takes only one format gets that one.
func stackPayload(key string, rows []LibraryRow) FilePayload {
	lead := filePayload(key, rows[0])
	for _, row := range rows[1:] {
		lead.Variants = append(lead.Variants, filePayload(key, row))
	}
	return lead
}
