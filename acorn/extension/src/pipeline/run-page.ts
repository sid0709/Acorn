import { extractVisiblePageText } from "@acorn/shared/page-text";
import { collectPageControls, pageSignature, type PageControl } from "@acorn/shared/page-controls";
import {
  EMPTY_FIELD_ISSUE_SCAN,
  countFlaggedFields,
  type FieldIssueScan,
} from "@acorn/shared/field-issues";
import { formatAnalyzeTrees } from "@acorn/shared/tree-export";

import { fetchDomFromTab } from "./fetch-dom";
import { fetchPostingDomFromTab } from "./fetch-posting";
import { embeddedFrames } from "./run-frames";
import { RUN_PAGE_TEXT_MAX_CHARS } from "./run-limits";

import type { DomTreeNode } from "@acorn/shared/tree-export";

/** What the run knows about the page at one moment. */
export interface PageSnapshot {
  tabId: number;
  url: string;
  title: string;
  frameId: number | null;
  text: string;
  controls: PageControl[];
  scan: FieldIssueScan;
  /** Fields the page marks invalid or ties an error message to. */
  flagged: number;
  signature: string;
  /** Embedded frames outside the read frame, by title or address. */
  frames: string[];
}

/**
 * Read the page. A first look takes the frame with the most text, so a posting is
 * read at once; a form read takes the frame that holds the form and waits for it.
 */
export async function snapshotPage(
  tabId: number,
  opts: { form: boolean; frameId?: number | null },
): Promise<PageSnapshot> {
  const payload = opts.form
    ? await fetchDomFromTab(tabId, opts.frameId ?? null, { fieldIssues: true })
    : await fetchPostingDomFromTab(tabId, { fieldIssues: true });
  const tree = payload.tree as DomTreeNode;
  const title = payload.title || "Untitled";
  const url = payload.url || "";
  const text = extractVisiblePageText(formatAnalyzeTrees(tree).pure, { title, url }).slice(
    0,
    RUN_PAGE_TEXT_MAX_CHARS,
  );
  const scan = payload.fieldIssues ?? EMPTY_FIELD_ISSUE_SCAN;
  const frameId = payload.frameId ?? null;
  return {
    tabId,
    url,
    title,
    frameId,
    text,
    controls: collectPageControls(tree),
    scan,
    flagged: countFlaggedFields(scan),
    signature: pageSignature(tree, url, text),
    frames: await embeddedFrames(tabId, frameId, tree),
  };
}
