package resume

import (
	"archive/zip"
	"bytes"
	"io"
	"regexp"
	"strconv"
	"strings"
)

var namedToken = regexp.MustCompile(`\{([A-Za-z][A-Za-z0-9_]*)\}`)

func parseTemplateDocx(data []byte) (slots []TemplateSlot, sections []string, warnings []string, err error) {
	xml, err := readDocumentXML(data)
	if err != nil {
		return nil, nil, []string{"could not read the DOCX"}, err
	}
	text := stripXML(xml)
	matches := namedToken.FindAllStringSubmatch(text, -1)
	seen := map[string]bool{}
	for i, match := range matches {
		token := match[1]
		slot := classifyToken(token, i)
		slots = append(slots, slot)
		if slot.Section != "" && !seen[slot.Section] {
			seen[slot.Section] = true
			sections = append(sections, slot.Section)
		}
	}
	if strings.Contains(text, "{}") {
		warnings = append(warnings, "anonymous {} placeholders need names like {summary}")
	}
	if len(slots) == 0 {
		warnings = append(warnings, "no {placeholders} found")
	}
	return slots, sections, warnings, nil
}

func classifyToken(token string, index int) TemplateSlot {
	slot := TemplateSlot{Index: index, Token: token, ParagraphIndex: index, Kind: "summary", Section: "summary"}
	if m := regexp.MustCompile(`(?i)^title(\d+)$`).FindStringSubmatch(token); len(m) == 2 {
		n, _ := strconv.Atoi(m[1])
		exp := max(0, n-1)
		slot.Kind, slot.Section, slot.ExperienceIndex = "title", "experience", &exp
		return slot
	}
	if m := regexp.MustCompile(`(?i)^experience(\d+)$`).FindStringSubmatch(token); len(m) == 2 {
		n, _ := strconv.Atoi(m[1])
		exp := max(0, n-1)
		slot.Kind, slot.Section, slot.ExperienceIndex, slot.IsBullet = "bullets", "experience", &exp, true
		return slot
	}
	switch strings.ToLower(token) {
	case "summary":
		slot.Kind, slot.Section = "summary", "summary"
	case "title":
		slot.Kind, slot.Section = "headline", "title"
	case "category_name":
		slot.Kind, slot.Section = "category", "skills"
	case "category_content", "skills":
		slot.Kind, slot.Section = "items", "skills"
	case "name", "full_name":
		slot.Kind, slot.Section = "headline", "title"
	}
	return slot
}

func fillTemplateDocx(data []byte, values map[string]string) ([]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, file := range reader.File {
		src, err := file.Open()
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(src)
		src.Close()
		if err != nil {
			return nil, err
		}
		if file.Name == "word/document.xml" {
			xml := string(body)
			for token, value := range values {
				xml = strings.ReplaceAll(xml, "{"+token+"}", escapeXML(value))
			}
			xml = namedToken.ReplaceAllString(xml, "")
			body = []byte(xml)
		}
		dst, err := writer.Create(file.Name)
		if err != nil {
			return nil, err
		}
		if _, err := dst.Write(body); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func fillValues(identity Identity, sections map[string]any, templateID string) map[string]string {
	content := normalizeSections(sections)
	values := map[string]string{
		"summary":   content.Summary,
		"name":      identity.FullName,
		"full_name": identity.FullName,
		"title":     identity.FullName,
		"email":     identity.Email,
		"phone":     identity.Phone,
		"location":  identity.Location,
		"linkedin":  identity.Linkedin,
	}
	if len(content.Skills) > 0 {
		values["category_name"] = content.Skills[0].Category
		values["category_content"] = strings.Join(content.Skills[0].Items, ", ")
		var all []string
		for _, group := range content.Skills {
			all = append(all, group.Category+": "+strings.Join(group.Items, ", "))
		}
		values["skills"] = strings.Join(all, "; ")
	}
	for i, role := range content.Experience {
		n := strconv.Itoa(i + 1)
		values["title"+n] = strings.TrimSpace(role.Title + " · " + role.Company)
		values["experience"+n] = strings.Join(role.Bullets, " ")
	}
	_ = templateID
	return values
}

func readDocumentXML(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	for _, file := range reader.File {
		if file.Name != "word/document.xml" {
			continue
		}
		src, err := file.Open()
		if err != nil {
			return "", err
		}
		body, err := io.ReadAll(src)
		src.Close()
		return string(body), err
	}
	return "", ErrInvalid
}

func stripXML(xml string) string {
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

func extractDocxText(data []byte) string {
	xml, err := readDocumentXML(data)
	if err != nil {
		return ""
	}
	return collapseSpace(stripXML(xml))
}

func escapeXML(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return replacer.Replace(value)
}

func collapseSpace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
