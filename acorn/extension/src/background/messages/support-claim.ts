import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";
import { usageTabKey } from "../../tab-usage-key";
const CAPTURE_FORMAT = "png" as const;

export async function handleSubmitSupportClaim(
  message: { tabId?: number },
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; error?: string }> {
  const tabId = message.tabId ?? sender.tab?.id;
  if (tabId == null) {
    return { ok: false, error: "No active tab to report." };
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.windowId) {
    return { ok: false, error: "Could not read the active tab." };
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: CAPTURE_FORMAT });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const tabKey = await usageTabKey(tabId).catch(() => "");
  const version = import.meta.env.VITE_ACORN_VERSION ?? "";
  const res = await fetch(`${base}/acorn/support/claims`, {
    method: "POST",
    headers: {
      ...(await authHeaders(tabId)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pageUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
      extensionVersion: version,
      tabKey,
      screenshotMime: "image/png",
      screenshotBase64: base64,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: payload.error || payload.message || `Report failed (${res.status})`,
    };
  }
  return { ok: true };
}
