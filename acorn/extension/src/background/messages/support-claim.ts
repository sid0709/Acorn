import { messageFormData } from "@acorn/support-chat/form";
import {
  MAX_NOTES_LENGTH,
  SUPPORT_CLAIMS_PATH,
  supportClaimLogPath,
  supportClaimMessagesPath,
} from "@acorn/support-chat/types";

import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";
import { usageTabKey } from "../../tab-usage-key";
import { blobToBase64, captureFullPage, captureVisible } from "../capture/full-page";
import { reportLogGzipBase64 } from "../report-log";

import type { FullPageShot } from "../capture/full-page";

/** support.MaxScreenshotBytes in acorn-backend; the same bound applies to a follow-up's image. */
const MAX_SCREENSHOT_BYTES = 8 << 20;
/** The name a follow-up's screenshot carries in the conversation. */
const SCREENSHOT_NAME = "screenshot";

type ApiAnswer = {
  error?: string;
  /** An error's text, or (for a follow-up) the message just filed, which its log goes under. */
  message?: string | { id?: string };
  claim?: { id?: string };
};
type ReportResult = { ok: boolean; error?: string; claimId?: string };

/**
 * Captures the whole page of the tab and files it with the person's notes: as a new
 * support claim, or (with `claimId`) as a follow-up message on that open claim.
 */
export async function handleSubmitSupportClaim(
  message: { tabId?: number; notes?: unknown; claimId?: unknown },
  sender: chrome.runtime.MessageSender,
): Promise<ReportResult> {
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
  const claimId = typeof message.claimId === "string" && message.claimId ? message.claimId : null;
  const res = claimId
    ? await postFollowUp(base, tabId, claimId, tab, notes, shot)
    : await postClaim(base, tabId, tab, notes, shot);
  const payload = (await res.json().catch(() => ({}))) as ApiAnswer;
  if (!res.ok) {
    return {
      ok: false,
      error:
        payload.error ||
        (typeof payload.message === "string" ? payload.message : "") ||
        `Report failed (${res.status})`,
    };
  }
  const filedId = claimId ?? payload.claim?.id;
  // The log leaves the browser here and nowhere else: the report is filed, so its log goes with it.
  if (filedId) {
    const messageId = typeof payload.message === "object" ? payload.message?.id : undefined;
    await sendReportLog(base, tabId, filedId, messageId);
  }
  return { ok: true, claimId: filedId };
}

/** Send the tab's local log with the report just filed; a failure never fails the report. */
async function sendReportLog(
  base: string,
  tabId: number,
  claimId: string,
  messageId?: string,
): Promise<void> {
  try {
    const gzipBase64 = await reportLogGzipBase64(tabId);
    if (!gzipBase64) return;
    await fetch(`${base}${supportClaimLogPath(claimId)}`, {
      method: "POST",
      headers: await authHeaders(tabId),
      body: JSON.stringify({ messageId: messageId ?? "", gzipBase64 }),
    });
  } catch {
    // The report is filed; the log is the extra.
  }
}

async function postClaim(
  base: string,
  tabId: number,
  tab: chrome.tabs.Tab,
  notes: string,
  shot: FullPageShot,
): Promise<Response> {
  const tabKey = await usageTabKey(tabId).catch(() => "");
  return fetch(`${base}${SUPPORT_CLAIMS_PATH}`, {
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
}

/** The page, its screenshot, and the notes as one message on an open claim. */
async function postFollowUp(
  base: string,
  tabId: number,
  claimId: string,
  tab: chrome.tabs.Tab,
  notes: string,
  shot: FullPageShot,
): Promise<Response> {
  const headers = await authHeaders(tabId);
  // The multipart body sets its own Content-Type, boundary included.
  delete headers["Content-Type"];
  const extension = shot.mime.split("/")[1] ?? "";
  const file = new File([shot.blob], `${SCREENSHOT_NAME}.${extension}`, { type: shot.mime });
  return fetch(`${base}${supportClaimMessagesPath(claimId)}`, {
    method: "POST",
    headers,
    body: messageFormData({
      body: notes,
      files: [file],
      pageUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
    }),
  });
}
