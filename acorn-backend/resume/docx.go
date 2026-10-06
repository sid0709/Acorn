package resume

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
)

func renderDocx(identity Identity, sections map[string]any, cfg map[string]any) ([]byte, error) {
	templateID := asString(cfg["templateId"])
	if strings.HasPrefix(templateID, "upload:") {
		return nil, ErrInvalid
	}
	content := normalizeSections(sections)
	var body strings.Builder
	body.WriteString(docxPara(identity.FullName, true))
	contact := strings.Join(nonempty(identity.Email, identity.Phone, identity.Location, identity.Linkedin), " · ")
	if contact != "" {
		body.WriteString(docxPara(contact, false))
	}
	if content.Summary != "" {
		body.WriteString(docxPara("SUMMARY", true))
		body.WriteString(docxPara(content.Summary, false))
	}
	if len(content.Skills) > 0 {
		body.WriteString(docxPara("SKILLS", true))
		for _, group := range content.Skills {
			body.WriteString(docxPara(group.Category+": "+strings.Join(group.Items, ", "), false))
		}
	}
	if len(content.Experience) > 0 {
		body.WriteString(docxPara("EXPERIENCE", true))
		for _, role := range content.Experience {
			body.WriteString(docxPara(strings.TrimSpace(role.Title+" · "+role.Company+" · "+role.Period), true))
			for _, bullet := range role.Bullets {
				body.WriteString(docxPara("• "+bullet, false))
			}
		}
	}
	if len(identity.Education) > 0 {
		body.WriteString(docxPara("EDUCATION", true))
		for _, row := range identity.Education {
			body.WriteString(docxPara(strings.TrimSpace(row.School+" · "+row.Degree+" · "+row.Period), false))
		}
	}
	document := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>%s<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`, body.String())
	return zipDocx(map[string]string{
		"[Content_Types].xml": contentTypesXML,
		"_rels/.rels":         relsXML,
		"word/document.xml":   document,
		"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
	})
}

func docxPara(text string, bold bool) string {
	rpr := ""
	if bold {
		rpr = "<w:rPr><w:b/></w:rPr>"
	}
	return fmt.Sprintf(`<w:p><w:r>%s<w:t xml:space="preserve">%s</w:t></w:r></w:p>`, rpr, escapeXML(text))
}

func zipDocx(files map[string]string) ([]byte, error) {
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for name, body := range files {
		file, err := writer.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := file.Write([]byte(body)); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

const contentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const relsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

func fileNameFor(identity Identity) string {
	name := strings.TrimSpace(identity.FullName)
	if name == "" {
		name = "Resume"
	}
	name = strings.ReplaceAll(name, " ", "_")
	return name + "_Resume.docx"
}
