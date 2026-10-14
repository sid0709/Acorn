import { describe, expect, test } from "bun:test";
import { aliasFromPath } from "./library-alias";
import { resumesFromFolder } from "./library-batch";

const picked = (path: string) => {
  const file = new File(["x"], path.split("/").pop() ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};

describe("aliasFromPath", () => {
  test("joins the folders below the picked one and the file name", () => {
    expect(aliasFromPath("Resume/FullStack/Java/David.docx")).toBe("fullstack-java-david.docx");
    expect(aliasFromPath("Resume/AI/name.docx")).toBe("ai-name.docx");
  });

  test("a file directly in the picked folder is aliased by its name", () => {
    expect(aliasFromPath("Resume/David.docx")).toBe("david.docx");
  });

  test("a path with no folder is aliased by the file name", () => {
    expect(aliasFromPath("David.docx")).toBe("david.docx");
  });

  test("whitespace becomes a dash and Windows separators work", () => {
    expect(aliasFromPath("Resume\\Full Stack\\David  Kim.pdf")).toBe("full-stack-david-kim.pdf");
  });
});

describe("resumesFromFolder", () => {
  test("aliases every résumé and skips hidden and unsupported files", () => {
    const result = resumesFromFolder([
      picked("Resume/FullStack/Java/David.docx"),
      picked("Resume/AI/name.pdf"),
      picked("Resume/AI/.DS_Store"),
      picked("Resume/.git/notes.txt"),
      picked("Resume/AI/photo.png"),
    ]);
    expect(result.ok && result.items.map((item) => item.alias)).toEqual([
      "fullstack-java-david.docx",
      "ai-name.pdf",
    ]);
  });

  test("a folder with no résumés is an error", () => {
    expect(resumesFromFolder([picked("Resume/photo.png")]).ok).toBe(false);
  });
});
