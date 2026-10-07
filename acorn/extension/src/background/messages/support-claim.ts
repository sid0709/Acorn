import { MAX_NOTES_LENGTH, SUPPORT_CLAIMS_PATH } from "@acorn/support-chat/types";
import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";
import { usageTabKey } from "../../tab-usage-key";
import { blobToBase64, captureFullPage, captureVisible } from "../capture/full-page";

/** support.MaxScreenshotBytes in acorn-backend. */
const MAX_SCREENSHOT_BYTES = 8 << 20;

/** Captures the whole page of the tab and files it with the person's notes as a support claim. */
export async function handleSubmitSupportClaim(
  message: { tabId?: number; notes?: unknown },
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; error?: string; claimId?: string }> {
  const tabId = message.tabId ?? sender.tab?.id;
  if (tabId == null) {
    return { ok: false, error: "No active tab to report." };
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.windowId) {
    return { ok: false, error: "Could not read the active tab." };
  }
  const notes =
    typeof message.notes === "string" ? message.notes.trim().slice(0, MAX_NOTES_LENGTH) : "";
  const shot = await captureFullPage(tabId, tab.windowId, MAX_SCREENSHOT_BYTES).catch(() =>
    captureVisible(tab.windowId),
  );
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const tabKey = await usageTabKey(tabId).catch(() => "");
  const res = await fetch(`${base}${SUPPORT_CLAIMS_PATH}`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify({
      pageUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
      notes,
      extensionVersion: import.meta.env.VITE_ACORN_VERSION ?? "",
      tabKey,
      screenshotMime: shot.mime,
      screenshotWidth: shot.width,
      screenshotHeight: shot.height,
      screenshotBase64: await blobToBase64(shot.blob),
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    claim?: { id?: string };
  };
  if (!res.ok) {
    return {
      ok: false,
      error: payload.error || payload.message || `Report failed (${res.status})`,
    };
  }
  return { ok: true, claimId: payload.claim?.id };
}
