import { ACORN_CAPTURE } from "../debug-trace";
import { sendTabMessage } from "../tab-messaging";
import { MSG } from "../types";

import { postDebug } from "./debug-post";

/** The backend route that stores one page's HTML in the tab's capture. */
const DEBUG_HTML_PATH = "/acorn/debug/html";
/** A frame silent this long is skipped; capture never holds the run up for long. */
const CAPTURE_HTML_TIMEOUT_MS = 3_000;

/** The main document's frame id. */
const MAIN_FRAME_ID = 0;

/**
 * Store the page's HTML (passwords removed) in the tab's capture at a moment the
 * run marks: the main document, and the frame the run reads when that is another.
 */
export async function captureDebugHtml(
  tabId: number,
  label: string,
  readFrameId?: number | null,
): Promise<void> {
  if (!ACORN_CAPTURE) return;
  const frames = [...new Set([MAIN_FRAME_ID, readFrameId ?? MAIN_FRAME_ID])];
  await Promise.all(
    frames.map(async (frameId) => {
      const res = await sendTabMessage<{ ok?: boolean; html?: string; url?: string }>(
        tabId,
        { type: MSG.CAPTURE_HTML },
        frameId,
        CAPTURE_HTML_TIMEOUT_MS,
      );
      if (!res?.ok || !res.html) return;
      await postDebug(DEBUG_HTML_PATH, { label, frameId, url: res.url, html: res.html }, tabId);
    }),
  );
}
