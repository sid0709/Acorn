import { PAGE_TEXT_MAX_CHARS } from "../../../shared/page-text";
import { formatAnalyzeTrees, type DomTreeNode } from "../../../shared/tree-export";
import { broadcastOperatorNotice } from "../operator-notice";
import { addPageWork, patchPage } from "../tab-page-session";
import { requestJdShot } from "./ai-client";
import { fetchDomFromTab } from "./run-pipeline";

export const NO_JD = "No job description on this page";
const NO_MATCH = "A posting was found, but no Library résumé fit it";

function capText(text: string): string {
  return text.length > PAGE_TEXT_MAX_CHARS ? text.slice(0, PAGE_TEXT_MAX_CHARS) : text;
}

/**
 * JD shot: the page's DOM tree, formatted as Fill's AI Analyze reads it, goes to the backend.
 * Jev checks it is a job posting and, if so, picks the Library résumé. A page with no posting
 * keeps any earlier pick.
 */
export async function runJdShot(args: { tabId: number; apiUrl: string }): Promise<void> {
  const { tabId, apiUrl } = args;
  const startedAt = Date.now();
  await patchPage(tabId, { jdStatus: "running", jdMessage: null });
  try {
    const treePayload = await fetchDomFromTab(tabId);
    const { pureTree } = formatAnalyzeTrees(treePayload.tree as unknown as DomTreeNode);
    const pageText = capText(pureTree);
    if (!pageText.trim()) {
      throw new Error("No readable text on this tab");
    }
    const result = await requestJdShot({ pageText }, apiUrl, tabId);
    if (!result.hasJobDescription) {
      await patchPage(tabId, { jdStatus: "none", jdMessage: result.reason || NO_JD });
      return;
    }
    if (!result.resumeId) {
      await patchPage(tabId, { jdStatus: "found", jdMessage: NO_MATCH });
      return;
    }
    await patchPage(tabId, {
      jdStatus: "found",
      jdMessage: null,
      resumeId: result.resumeId,
      resumeStack: result.stack,
      resumeReason: result.matchReason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patchPage(tabId, { jdStatus: "failed", jdMessage: message });
    broadcastOperatorNotice({ kind: "error", title: "JD shot failed", detail: message });
  } finally {
    await addPageWork(tabId, { durationMs: Date.now() - startedAt }).catch(() => undefined);
  }
}
