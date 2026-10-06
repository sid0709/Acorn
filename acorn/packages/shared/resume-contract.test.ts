import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { historyQueryString } from "./resume-api.ts";
import { defaultResumeConfig, mergeStoredResumeConfig } from "./resume-config.ts";
import { mergeGeneratedSection, normalizeGeneratedContent } from "./resume-content.ts";
import { resumeFontStack } from "./resume-fonts.ts";
import { jdHeadline } from "./resume-history.ts";
import {
  isUploadedTemplateId,
  resumeTemplateById,
  uploadedTemplateDocumentId,
  uploadedTemplateId,
} from "./resume-templates.ts";

describe("resume templates", () => {
  it("falls back to classic and round-trips uploaded ids", () => {
    assert.equal(resumeTemplateById("missing").id, "classic");
    assert.equal(resumeTemplateById("harvard").name, "Harvard");
    const id = uploadedTemplateId("abc");
    assert.equal(isUploadedTemplateId(id), true);
    assert.equal(uploadedTemplateDocumentId(id), "abc");
  });
});

describe("resume config", () => {
  it("restores a stored template and drops unknown sections", () => {
    const merged = mergeStoredResumeConfig({
      templateId: "modern",
      theme: { font: "Inter", accent: "#2563eb" },
      jobDescription: "keep on the editor, not in PUT",
    });
    assert.equal(merged.templateId, "modern");
    assert.equal(merged.theme.font, "Inter");
    assert.equal(merged.layout.length, 4);
    assert.equal(merged.steps.length, 3);
    assert.equal(defaultResumeConfig().templateId, "classic");
  });
});

describe("resume content", () => {
  it("normalizes experience aliases and merges a finished summary step", () => {
    const content = normalizeGeneratedContent({
      summary: { summary: "Lead builder." },
      experience: { experiences: [{ role: "Engineer", company: "Acorn", bullets: ["Shipped"] }] },
    });
    assert.equal(content.summary, "Lead builder.");
    assert.equal(content.experience?.[0]?.title, "Engineer");
    const merged = mergeGeneratedSection(null, "skills", {
      skills: [{ category: "Go", items: ["HTTP"] }],
    });
    assert.equal(merged.skills?.[0]?.category, "Go");
  });
});

describe("resume helpers", () => {
  it("builds a serif stack and a history query", () => {
    assert.equal(resumeFontStack("Times New Roman"), '"Times New Roman", serif');
    assert.equal(jdHeadline("First line\nSecond", 8), "First li…");
    assert.equal(
      historyQueryString({ search: "go", searchIn: "resume", includeFacets: true }),
      "?search=go&searchIn=resume&includeFacets=1",
    );
  });
});
