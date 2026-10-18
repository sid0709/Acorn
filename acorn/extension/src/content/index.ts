import { traceFromPage } from "../debug-trace";

import { initPrefillBridge } from "./prefill-bridge";
import { initSupportHandoff } from "./support-handoff";

// A failure in the extension's own page code is written to the tab's log. The page's
// own script errors (other origins) are the site's business, not ours.
window.addEventListener("error", (event) => {
  if (!event.filename.startsWith("chrome-extension://")) return;
  traceFromPage("page:error", () => ({
    message: event.message,
    file: event.filename,
    line: event.lineno,
  }));
});
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  if (!(reason instanceof Error) || !reason.stack?.includes("chrome-extension://")) return;
  traceFromPage("page:error", () => ({ message: reason.message, stack: reason.stack }));
});

const CONTENT_BOOT = "__acornContentBoot";

/**
 * What a started script leaves on its window: a check that it still works. After the
 * extension reloads or updates, a script already in a page is cut off from it (its
 * context is gone) but stays in the page, and a flag that only said "started" would keep
 * the new script from starting there.
 */
type AcornContentWindow = Window & { [CONTENT_BOOT]?: () => boolean };
const contentWindow = window as AcornContentWindow;

function contentScriptAlive(): boolean {
  const alive = contentWindow[CONTENT_BOOT];
  return typeof alive === "function" && alive();
}

/**
 * Startup work is independent: one of them failing, say a page's content policy refusing
 * what a chip draws, must not keep the other from starting.
 */
function startSafely(name: string, start: () => void): void {
  try {
    start();
  } catch (err) {
    traceFromPage("boot:error", () => ({
      step: name,
      message: err instanceof Error ? err.message : String(err),
    }));
  }
}

if (!contentScriptAlive()) {
  contentWindow[CONTENT_BOOT] = () => Boolean(chrome.runtime?.id);

  startSafely("support-handoff", initSupportHandoff);
  startSafely("prefill-bridge", initPrefillBridge);
}
