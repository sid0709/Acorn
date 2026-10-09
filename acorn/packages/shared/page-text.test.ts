import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PAGE_TEXT_MAX_CHARS,
  clipEnds,
  combineFrameTexts,
  extractVisiblePageText,
} from "./page-text.ts";

import type { PureNode } from "./tree-export.ts";

function node(tag: string, text: string | undefined, children: PureNode[] = []): PureNode {
  return { tag, id: 1, text, children };
}

describe("extractVisiblePageText", () => {
  it("drops form chrome and keeps body copy", () => {
    const tree = node("body", undefined, [
      node("h1", "Staff engineer"),
      node("p", "Build the platform"),
      node("input", "type your name"),
      node("button", "Apply now"),
      node("select", undefined, [node("option", "Full-time")]),
    ]);
    const text = extractVisiblePageText(tree, {
      title: "Acme role",
      url: "https://jobs.example.com/a",
    });
    assert.match(text, /^Acme role\nhttps:\/\/jobs\.example.com\/a\n\n/);
    assert.match(text, /Staff engineer/);
    assert.match(text, /Build the platform/);
    assert.doesNotMatch(text, /type your name/);
    assert.doesNotMatch(text, /Apply now/);
    assert.doesNotMatch(text, /Full-time/);
  });

  it("returns empty when there is no readable body text", () => {
    const tree = node("form", undefined, [node("input", "email"), node("button", "Submit")]);
    assert.equal(extractVisiblePageText(tree, { title: "Form", url: "https://x.test" }), "");
  });

  it("caps combined length", () => {
    const tree = node("p", "x".repeat(PAGE_TEXT_MAX_CHARS + 80));
    const text = extractVisiblePageText(tree, { title: "Role" });
    assert.equal(text.length, PAGE_TEXT_MAX_CHARS);
    assert.match(text, /^Role\n\n/);
  });
});

describe("combineFrameTexts", () => {
  const careers = {
    title: "Careers at Gruve",
    url: "https://gruve.ai/careers/",
    text: "Shape the future with Gruve",
    top: true,
  };
  const posting = {
    title: "Job Application for AI Engineer at Gruve",
    url: "https://job-boards.greenhouse.io/embed/job_app?token=1",
    text: "About the Role\nWe are hiring a full-stack engineer.",
    top: false,
  };

  it("keeps the page and its embedded posting, posting first", () => {
    const text = combineFrameTexts([careers, posting]);
    assert.ok(text.startsWith("Careers at Gruve\nhttps://gruve.ai/careers/"));
    assert.ok(
      text.indexOf(
        "Embedded frame: Job Application for AI Engineer at Gruve · job-boards.greenhouse.io",
      ) < text.indexOf("--- Page: Careers at Gruve"),
    );
    assert.ok(text.includes("We are hiring a full-stack engineer."));
  });

  it("drops empty and repeated frames", () => {
    const text = combineFrameTexts([
      careers,
      { ...careers, top: false },
      { ...posting, text: " " },
    ]);
    assert.equal(text.split("--- ").length - 1, 1);
  });

  it("stays under the page text cap", () => {
    const long = { ...posting, text: "x".repeat(PAGE_TEXT_MAX_CHARS * 2) };
    assert.equal(combineFrameTexts([careers, long]).length, PAGE_TEXT_MAX_CHARS);
  });

  it("is empty when no frame has copy", () => {
    assert.equal(combineFrameTexts([{ ...careers, text: "" }]), "");
  });
});

describe("clipEnds", () => {
  it("keeps a short page whole", () => {
    assert.equal(clipEnds("Name\nEmail", 100), "Name\nEmail");
  });

  it("keeps both ends of a long page, so a prompt beside Submit survives", () => {
    const text = `${"Question\n".repeat(200)}Enter the code we emailed you`;
    const clipped = clipEnds(text, 300);
    assert.ok(clipped.length <= 300);
    assert.ok(clipped.startsWith("Question"));
    assert.ok(clipped.endsWith("Enter the code we emailed you"));
  });
});
