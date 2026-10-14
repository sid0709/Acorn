import { describe, expect, test } from "bun:test";
import type { ResumeLibraryRow } from "@acorn/shared/resume-library";
import { groupByStack } from "./library-cards";

const row = (id: string, title: string, format: ResumeLibraryRow["format"]) =>
  ({ id, title, format, fileName: `${title}.${format}` }) as ResumeLibraryRow;

describe("library stacks", () => {
  test("a PDF and a DOCX of one role become one group, PDF first", () => {
    const groups = groupByStack([
      row("a", "Platform Engineering", "docx"),
      row("b", "Frontend", "pdf"),
      row("c", "Platform Engineering", "pdf"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Platform Engineering", "Frontend"]);
    expect(groups[0].rows.map((item) => item.id)).toEqual(["c", "a"]);
  });

  test("a file with no title is labelled by its file name", () => {
    expect(groupByStack([row("a", "", "pdf")])[0].label).toBe(".pdf");
  });
});
