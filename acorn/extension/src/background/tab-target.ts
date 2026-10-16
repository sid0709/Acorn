/** Tab the caller pinned. Never the currently focused tab — Fill must stay on the tab that was active at click. */
export function pinnedTabId(
  requestedTabId: unknown,
  sender: chrome.runtime.MessageSender,
): number | null {
  if (typeof requestedTabId === "number" && Number.isFinite(requestedTabId)) {
    return requestedTabId;
  }
  return sender.tab?.id ?? null;
}

export async function resolvePreferredTabId(
  sender: chrome.runtime.MessageSender,
  requestedTabId: unknown,
): Promise<number | null> {
  const pinned = pinnedTabId(requestedTabId, sender);
  if (pinned != null) return pinned;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}
