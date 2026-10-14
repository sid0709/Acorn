import {
  EMPTY_FIELD_ISSUE_SCAN,
  countFlaggedFields,
  type FieldIssueScan,
} from "@acorn/shared/field-issues";
import {
  collectPageControls,
  countFormFields,
  pageSignature,
  type PageControl,
} from "@acorn/shared/page-controls";
import { clipEnds, extractVisiblePageText } from "@acorn/shared/page-text";
import { formatPlannerTree } from "@acorn/shared/planner-tree";
import { formatAnalyzeTrees, withoutHidden } from "@acorn/shared/tree-export";

import { traceFromBackground } from "../background/debug-trace-sink";
import { canInjectIntoUrl, injectContentScripts } from "../inject-content";
import { LOG_KIND, logTab } from "../tab-log-session";

import { fetchDomFromTab } from "./fetch-dom";
import { fetchPostingDomFromTab } from "./fetch-posting";
import { embeddedFrames } from "./run-frames";
import {
  RUN_PAGE_READ_PATIENCE_MS,
  RUN_PAGE_READ_RETRY_MS,
  RUN_PAGE_TEXT_MAX_CHARS,
} from "./run-limits";

import type { OpenScope } from "../types";
import type { FormField } from "@acorn/shared/form-fields";
import type { DomTreeNode } from "@acorn/shared/tree-export";

/** What the run knows about the page at one moment. */
export interface PageSnapshot {
  tabId: number;
  url: string;
  title: string;
  frameId: number | null;
  /** The visible text, both ends kept when it is long; what the decision model reads. */
  text: string;
  /** The whole visible text, so the run can tell exactly what is new on the page. */
  fullText: string;
  controls: PageControl[];
  scan: FieldIssueScan;
  /** Fields the page marks invalid or ties an error message to. */
  flagged: number;
  signature: string;
  /** Fields the page asks for; 0 on a page with nothing to fill (an account step, a gate). */
  fields: number;
  /** Those fields as the planner lists them (label, kind, required, choices): what the decision model is shown. */
  formFields: FormField[];
  /** Embedded frames outside the read frame, by title or address. */
  frames: string[];
  /** Read with `scope`: what the run's last opening click drew, in this read's node ids. */
  scope?: OpenScope | null;
}

/**
 * Read the page. A first look takes the frame with the most text, so a posting is
 * read at once; a form read takes the frame that holds the form and waits for it.
 */
/**
 * Read the page, patiently: a read that fails while the page is still loading or
 * before its content script answers is tried again (the script is injected again
 * when the page lost it) until RUN_PAGE_READ_PATIENCE_MS runs out.
 */
export async function snapshotPage(
  tabId: number,
  opts: { form: boolean; frameId?: number | null; scope?: boolean },
): Promise<PageSnapshot> {
  const started = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await readPage(tabId, opts);
    } catch (err) {
      if (Date.now() - started >= RUN_PAGE_READ_PATIENCE_MS) throw err;
      traceFromBackground(
        "run:page-read-retry",
        () => ({
          attempt,
          error: err instanceof Error ? err.message : String(err),
        }),
        tabId,
      );
      await new Promise((resolve) => setTimeout(resolve, RUN_PAGE_READ_RETRY_MS));
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw err;
      if (tab.status === "complete" && canInjectIntoUrl(tab.url)) {
        await injectContentScripts(tabId).catch(() => undefined);
      }
    }
  }
}

async function readPage(
  tabId: number,
  opts: { form: boolean; frameId?: number | null; scope?: boolean },
): Promise<PageSnapshot> {
  const payload = opts.form
    ? await fetchDomFromTab(tabId, opts.frameId ?? null, {
        fieldIssues: true,
        formFields: true,
        scope: opts.scope === true,
      })
    : await fetchPostingDomFromTab(tabId, { fieldIssues: true });
  const tree = payload.tree as DomTreeNode;
  const title = payload.title || "Untitled";
  const url = payload.url || "";
  const fullText = extractVisiblePageText(formatAnalyzeTrees(withoutHidden(tree)).pure, {
    title,
    url,
  });
  const text = clipEnds(fullText, RUN_PAGE_TEXT_MAX_CHARS);
  const scan = payload.fieldIssues ?? EMPTY_FIELD_ISSUE_SCAN;
  const frameId = payload.frameId ?? null;
  const formFields = payload.formFields ?? [];
  // What this read was made from, so a decision the model made on it can be explained
  // from the log alone: the compressed tree and the fields it was shown.
  logTab(
    tabId,
    LOG_KIND.pureTree,
    `Compressed tree (page read) · ${countFormFields(tree)} fields`,
    () => formatPlannerTree(tree),
  );
  logTab(tabId, LOG_KIND.analysis, `Fields (page read) · ${formFields.length} fields`, () => ({
    url,
    title,
    formFields,
  }));
  return {
    tabId,
    url,
    title,
    frameId,
    text,
    fullText,
    controls: collectPageControls(tree),
    scan,
    flagged: countFlaggedFields(scan),
    signature: pageSignature(tree, url, text),
    fields: countFormFields(tree),
    formFields,
    frames: await embeddedFrames(tabId, frameId, tree),
    scope: payload.scope,
  };
}
