import { sendTabMessage } from "../tab-messaging";
import { MSG, type DomNode, type DomTreePayload } from "../types";

/** Every frame answers a posting read at once; a frame silent this long is skipped. */
const POSTING_FRAME_TIMEOUT_MS = 1_500;

type FrameReply = DomTreePayload & { error?: string; skipped?: boolean };

function treeTextLength(node: DomNode): number {
  return (
    (node.text?.length ?? 0) + node.children.reduce((sum, child) => sum + treeTextLength(child), 0)
  );
}

/**
 * Snapshot every frame of the tab for reading a job posting, at once and with no
 * waiting for a form to hydrate. Each frame serializes only what a person can see.
 */
export async function fetchPostingFramesFromTab(
  tabId: number,
  opts: { fieldIssues?: boolean } = {},
): Promise<DomTreePayload[]> {
  let frameIds = [0];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames?.length) frameIds = frames.map((frame) => frame.frameId);
  } catch {
    // Restricted pages: the main frame only.
  }
  const replies = await Promise.all(
    frameIds.map((frameId) =>
      sendTabMessage<FrameReply | null>(
        tabId,
        { type: MSG.FETCH_DOM, posting: true, fieldIssues: Boolean(opts.fieldIssues) },
        frameId,
        POSTING_FRAME_TIMEOUT_MS,
      ).then((reply): DomTreePayload | null =>
        reply?.tree && !reply.error ? { ...reply, tabId, frameId } : null,
      ),
    ),
  );
  const trees = replies.filter((reply): reply is DomTreePayload => reply != null);
  if (!trees.length) {
    throw new Error("Could not read this tab. Refresh the page, then try again.");
  }
  return trees;
}

/** The one frame with the most visible text (the posting can live in an embedded job-board frame). */
export async function fetchPostingDomFromTab(
  tabId: number,
  opts: { fieldIssues?: boolean } = {},
): Promise<DomTreePayload> {
  const trees = await fetchPostingFramesFromTab(tabId, opts);
  return trees.reduce((best, next) =>
    treeTextLength(next.tree) > treeTextLength(best.tree) ? next : best,
  );
}
