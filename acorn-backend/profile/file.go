package profile

import (
	"archive/zip"
	"bytes"
	"io"
	"path/filepath"
	"regexp"
	"strings"
)

func fileText(name string, data []byte) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".docx":
		return docxLines(data)
	case ".pdf":
		return pdfLines(data)
	default:
		return string(data)
	}
}

func docxLines(data []byte) string {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	for _, file := range reader.File {
		if file.Name != "word/document.xml" {
			continue
		}
		src, err := file.Open()
		if err != nil {
			return ""
		}
		body, err := io.ReadAll(src)
		src.Close()
		if err != nil {
			return ""
		}
		xml := strings.ReplaceAll(string(body), "</w:p>", "\n")
		return stripTags(xml)
	}
	return ""
}

func stripTags(xml string) string {
	var b strings.Builder
	in := false
	for _, r := range xml {
		switch {
		case r == '<':
			in = true
		case r == '>':
			in = false
		case !in:
			b.WriteRune(r)
		}
	}
	return b.String()
}

var pdfText = regexp.MustCompile(`\(((?:\\.|[^\\)])*)\)\s*Tj`)

func pdfLines(data []byte) string {
	var lines []string
	for _, match := range pdfText.FindAllSubmatch(data, -1) {
		lines = append(lines, unescapePDF(string(match[1])))
	}
	return strings.Join(lines, "\n")
}

func unescapePDF(value string) string {
	replacer := strings.NewReplacer(`\n`, "\n", `\r`, "", `\t`, " ", `\(`, "(", `\)`, ")", `\\`, `\`)
	return replacer.Replace(value)
}
