import {
  ACORN_SUPPORT_HANDOFF,
  ACORN_SUPPORT_HANDOFF_ACK,
  type AcornSupportHandoffAck,
} from "@acorn/shared/api";
import { DEFAULT_ACORN_WEB_URL } from "../auth/acorn-auth";
import { MSG } from "../types";

function onAcornSite(): boolean {
  try {
    return (
      window === window.top && window.location.origin === new URL(DEFAULT_ACORN_WEB_URL).origin
    );
  } catch {
    return false;
  }
}

/**
 * On the Acorn site only: relays a support sign-in code the page posts to the
 * service worker, and posts the outcome back so the page can say what happened.
 */
export function initSupportHandoff(): void {
  if (!onAcornSite()) return;
  window.addEventListener("message", (event: MessageEvent<{ type?: string; code?: unknown }>) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== ACORN_SUPPORT_HANDOFF || typeof event.data.code !== "string") return;
    const reply = (ack: Omit<AcornSupportHandoffAck, "type">) =>
      window.postMessage({ type: ACORN_SUPPORT_HANDOFF_ACK, ...ack }, window.location.origin);
    chrome.runtime.sendMessage(
      { type: MSG.SUPPORT_HANDOFF, code: event.data.code },
      (res?: { ok?: boolean; error?: string }) => {
        if (chrome.runtime.lastError) {
          reply({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        reply({ ok: Boolean(res?.ok), error: res?.error });
      },
    );
  });
}
