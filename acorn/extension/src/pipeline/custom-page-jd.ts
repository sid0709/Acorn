import {
  PAGE_TEXT_MAX_CHARS,
  combineFrameTexts,
  extractVisiblePageText,
} from "@acorn/shared/page-text";
import { formatAnalyzeTrees, type DomTreeNode } from "@acorn/shared/tree-export";

import { extractCustomJd } from "./api/custom-generate";
import { fetchDomFromTab } from "./fetch-dom";
import { fetchPostingFramesFromTab } from "./fetch-posting";

export const NO_JD = "No job description on this page";

export type RememberedTabJd = {
  jobDescription: string;
  title: string;
  url: string;
};

function capText(text: string): string {
  return text.length > PAGE_TEXT_MAX_CHARS ? text.slice(0, PAGE_TEXT_MAX_CHARS) : text;
}

/**
 * Custom Recommend: the tab's visible copy, as-is, from every frame. The
 * SelectorGateway (Jev) decides whether a posting is there and which Library
 * résumé fits it, so no text model rewrites it first and no frame is guessed.
 */
export async function readRememberedTabPosting(tabId: number): Promise<RememberedTabJd> {
  const frames = await fetchPostingFramesFromTab(tabId);
  const top = frames.find((frame) => frame.frameId === 0) ?? frames[0];
  const title = top.title || "Untitled";
  const url = top.url || "";
  const jobDescription = combineFrameTexts(
    frames.map((frame) => ({
      title: frame.title || "",
      url: frame.url || "",
      text: extractVisiblePageText(formatAnalyzeTrees(frame.tree as unknown as DomTreeNode).pure),
      top: frame === top,
    })),
  );
  if (!jobDescription.trim()) {
    throw new Error("No readable text on this tab");
  }
  return { jobDescription, title, url };
}

/**
 * Custom Generate: same DOM snapshot and formatted trees as Fill AI Analyze,
 * then extract-jd turns the pure tree (visible copy) into posting prose.
 */
export async function extractRememberedTabJd(
  tabId: number,
  apiUrl: string,
): Promise<RememberedTabJd> {
  const treePayload = await fetchDomFromTab(tabId);
  const { pureTree } = formatAnalyzeTrees(treePayload.tree);
  const pageText = capText(pureTree);
  if (!pageText.trim()) {
    throw new Error("No readable text on this tab");
  }
  const extracted = await extractCustomJd({ pageText }, apiUrl, tabId);
  if (!extracted.hasJobDescription || !extracted.jobDescription) {
    throw new Error(extracted.reason || NO_JD);
  }
  return {
    jobDescription: extracted.jobDescription,
    title: treePayload.title || "Untitled",
    url: treePayload.url || "",
  };
}
