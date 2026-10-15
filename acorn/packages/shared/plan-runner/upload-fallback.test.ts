import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withUploadFallback } from "./step-file.ts";

import type { PlanAction, RuntimeAttachedFile } from "./types.ts";

const letterAction = (fallback?: string): PlanAction => ({
  action: "upload",
  element_index: 5,
  element_indexes: null,
  expected_label: "Cover letter",
  expected_role: "file",
  value: "pdf",
  file: "cover_letter",
  reason: null,
  ms: null,
  fallback_file: fallback,
});

const letter = { name: "letter.pdf" } as RuntimeAttachedFile;

describe("withUploadFallback", () => {
  it("gives a required cover-letter field the résumé when the Library has no letter", () => {
    const action = withUploadFallback(letterAction("recommended_resume"), { coverLetter: null });
    assert.equal(action.action, "resume_upload");
    assert.equal(action.file, "recommended_resume");
    assert.equal(action.element_index, 5);
  });

  it("keeps the cover letter when there is one", () => {
    const action = withUploadFallback(letterAction("recommended_resume"), { coverLetter: letter });
    assert.equal(action.action, "upload");
    assert.equal(action.file, "cover_letter");
  });

  it("leaves an optional field (no fallback named) to the page", () => {
    const action = withUploadFallback(letterAction(), { coverLetter: null });
    assert.equal(action.action, "upload");
    assert.equal(action.file, "cover_letter");
  });
});
