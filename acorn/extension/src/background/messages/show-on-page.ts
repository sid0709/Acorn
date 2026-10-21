import { spotlightArgs, spotlightInPage } from "../../agent/field-spotlight";
import { pinnedTabId } from "../tab-target";
import { pipelineRunningTabIds } from "../work-state";

import type { RuntimeMessage, SendResponse } from "./shared";

/** Said when the person asks to see a field while a run works on the page: the run owns its scroll. */
export const SHOW_ON_PAGE_BUSY = "Acorn is working on this page. Try again once the run stops.";

/**
 * Shows the person a field of the page on this tab (`control`, an id of the run's control list) or a place on
 * it (`y`, CSS pixels from the page's top): the page scrolls there and the field is ringed. Never while a run
 * works on the tab.
 */
export function handleShowOnPage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  const tabId = pinnedTabId(message.tabId, sender);
  if (!tabId) {
    sendResponse({ error: "No tab to show it on" });
    return;
  }
  if (pipelineRunningTabIds.has(tabId)) {
    sendResponse({ error: SHOW_ON_PAGE_BUSY });
    return;
  }
  const control =
    typeof message.control === "string" && message.control !== "" ? message.control : null;
  const y = typeof message.y === "number" && Number.isFinite(message.y) ? message.y : null;
  if (control == null && y == null) {
    sendResponse({ error: "Nothing to show" });
    return;
  }
  chrome.scripting
    .executeScript({
      target: { tabId },
      world: "MAIN",
      func: spotlightInPage,
      args: [spotlightArgs(control, y)],
    })
    .then(([injected]) => sendResponse({ ok: true, shown: injected?.result }))
    .catch((err: unknown) =>
      sendResponse({ error: err instanceof Error ? err.message : String(err) }),
    );
}
