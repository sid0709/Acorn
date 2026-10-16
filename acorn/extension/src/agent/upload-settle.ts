/**
 * Waits after a file is set on an input until the page finishes processing it. Many
 * application forms parse the résumé and autofill other fields only after upload completes.
 */

import type { Cdp } from "./cdp";

/** Minimum time after the file is accepted before we treat processing as done. */
export const UPLOAD_PROCESS_MIN_MS = 800;
/** How often we ask the page whether it is still uploading. */
export const UPLOAD_PROCESS_POLL_MS = 250;
/** Longest we wait for upload processing before continuing anyway. */
export const UPLOAD_PROCESS_MAX_MS = 45_000;

const STILL_UPLOADING = `(() => {
  const busy = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute("aria-busy") === "true") return true;
    const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
    if (/\b(uploading|processing|spinner|loading)\b/.test(cls)) return true;
    return false;
  };
  const inputs = document.querySelectorAll('input[type="file"]');
  for (const input of inputs) {
    for (let node = input.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) {
      if (busy(node)) return true;
    }
  }
  const text = (document.body && document.body.innerText) || "";
  if (/\b(uploading|processing (your )?file|please wait)\b/i.test(text)) return true;
  const progress = document.querySelector('progress:not([value="100"])');
  if (progress && !progress.hasAttribute("hidden")) return true;
  return false;
})()`;

type EvaluateBool = { result?: { value?: boolean } };

/** Polls the page until upload UI settles or the max wait is reached. */
export async function waitForUploadProcessing(
  cdp: Cdp,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const started = Date.now();
  await sleep(UPLOAD_PROCESS_MIN_MS);
  while (Date.now() - started < UPLOAD_PROCESS_MAX_MS) {
    const answer = await cdp.send<EvaluateBool>("Runtime.evaluate", {
      expression: STILL_UPLOADING,
      returnByValue: true,
    });
    if (!answer.result?.value) return;
    await sleep(UPLOAD_PROCESS_POLL_MS);
  }
}
