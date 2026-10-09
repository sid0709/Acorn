import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chooseUploadFile } from "./upload-format.ts";

import type { RuntimeAttachedFile } from "@acorn/shared/plan-runner/types";

const docx: RuntimeAttachedFile = {
  key: "recommended_resume",
  name: "go.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  base64: "AA==",
  format: "docx",
  label: "Go",
};
const pdf: RuntimeAttachedFile = {
  ...docx,
  name: "go.pdf",
  mimeType: "application/pdf",
  format: "pdf",
};
const stack: RuntimeAttachedFile = { ...pdf, variants: [docx] };

const input = (accept: string) => ({ accept }) as HTMLInputElement;

describe("chooseUploadFile", () => {
  it("sends the preferred version when the field takes anything", () => {
    assert.equal(chooseUploadFile(input(""), stack).name, "go.pdf");
  });

  it("sends the version the field's accept list takes", () => {
    assert.equal(chooseUploadFile(input(".doc,.docx"), stack).name, "go.docx");
    assert.equal(chooseUploadFile(input("application/pdf"), stack).name, "go.pdf");
  });

  it("sends the format the plan read from the field's words", () => {
    assert.equal(chooseUploadFile(input(""), stack, "word").name, "go.docx");
  });

  it("never sends a format the field does not take", () => {
    assert.throws(() => chooseUploadFile(input(".pdf"), docx), /no file of that type/);
    assert.throws(() => chooseUploadFile(input(""), docx, "pdf"), /only a PDF/);
  });
});
