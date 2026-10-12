import { messageFormData } from "@acorn/support-chat/form";
import {
  MAX_NOTES_LENGTH,
  SUPPORT_CLAIMS_PATH,
  supportClaimMessagesPath,
} from "@acorn/support-chat/types";

import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";
import { usageTabKey } from "../../tab-usage-key";
import { blobToBase64, captureFullPage, captureVisible } from "../capture/full-page";
import { flushDebugShots } from "../debug-shot";
import { flushDebugTraces } from "../debug-trace-sink";

import type { FullPageShot } from "../capture/full-page";

/** support.MaxScreenshotBytes in acorn-backend; the same bound applies to a follow-up's image. */
const MAX_SCREENSHOT_BYTES = 8 << 20;
/** The name a follow-up's screenshot carries in the conversation. */
const SCREENSHOT_NAME = "screenshot";

type ApiAnswer = { error?: string; message?: string; claim?: { id?: string } };
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
  // The server copies this tab's debug run as the claim is saved. Screenshots can
  // queue a trace as they finish, so they go out before the trace flush.
  const flushed = flushDebugShots().then(() => flushDebugTraces());
  const shot = await captureFullPage(tabId, tab.windowId, MAX_SCREENSHOT_BYTES).catch(() =>
    captureVisible(tab.windowId),
  );
  await flushed;
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const claimId = typeof message.claimId === "string" && message.claimId ? message.claimId : null;
  const res = claimId
    ? await postFollowUp(base, tabId, claimId, tab, notes, shot)
    : await postClaim(base, tabId, tab, notes, shot);
  const payload = (await res.json().catch(() => ({}))) as ApiAnswer;
  if (!res.ok) {
    return {
      ok: false,
      error: payload.error || payload.message || `Report failed (${res.status})`,
    };
  }
  return { ok: true, claimId: claimId ?? payload.claim?.id };
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
