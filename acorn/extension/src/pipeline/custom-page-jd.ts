import { PAGE_TEXT_MAX_CHARS, extractVisiblePageText } from "@acorn/shared/page-text";
import { formatAnalyzeTrees, type DomTreeNode } from "@acorn/shared/tree-export";
import { extractCustomJd } from "./api/custom-generate";
import { fetchDomFromTab } from "./fetch-dom";

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
 * Custom Recommend: the tab's visible copy, as-is. The SelectorGateway (Jev) decides
 * whether it is a posting and which Library résumé fits it, so no text model
 * rewrites it first.
 */
export async function readRememberedTabPosting(tabId: number): Promise<RememberedTabJd> {
  const treePayload = await fetchDomFromTab(tabId);
  const { pure } = formatAnalyzeTrees(treePayload.tree as unknown as DomTreeNode);
  const title = treePayload.title || "Untitled";
  const url = treePayload.url || "";
  const jobDescription = extractVisiblePageText(pure, { title, url });
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
  const { pureTree } = formatAnalyzeTrees(treePayload.tree as unknown as DomTreeNode);
  const pageText = capText(pureTree);
  if (!pageText.trim()) {
    throw new Error("No readable text on this tab");
  }
  const extracted = await extractCustomJd({ pageText }, apiUrl);
  if (!extracted.hasJobDescription || !extracted.jobDescription) {
    throw new Error(extracted.reason || NO_JD);
  }
  return {
    jobDescription: extracted.jobDescription,
    title: treePayload.title || "Untitled",
    url: treePayload.url || "",
  };
}
