import {
  ACORN_EXTENSION_HELLO,
  ACORN_EXTENSION_PING,
  ACORN_SUPPORT_HANDOFF,
  ACORN_SUPPORT_HANDOFF_ACK,
  acornWebOrigins,
  type AcornExtensionHello,
  type AcornSupportHandoffAck,
} from "@acorn/shared/api";

import { DEFAULT_ACORN_WEB_URL, getAcornSession } from "../auth/acorn-auth";
import { MSG } from "../types";

type Outcome = Omit<AcornSupportHandoffAck, "type">;

function onAcornSite(): boolean {
  return (
    window === window.top &&
    acornWebOrigins([DEFAULT_ACORN_WEB_URL]).includes(window.location.origin)
  );
}

function redeem(code: string): Promise<Outcome> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: MSG.SUPPORT_HANDOFF, code },
      (res?: { ok?: boolean; error?: string }) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: Boolean(res?.ok), error: res?.error });
      },
    );
  });
}

function post(message: AcornExtensionHello | AcornSupportHandoffAck) {
  window.postMessage(message, window.location.origin);
}

/**
 * On the Acorn site only. Answers the page's ping with whom the extension is
 * signed in as, so a page in a support session can tell whether the extension
 * follows it; relays the page's support sign-in code to the service worker and
 * posts the outcome back. The page repeats its messages until it hears back
 * (this script may load after the page first posts), so each code is redeemed
 * once and its outcome reused.
 */
export function initSupportHandoff(): void {
  if (!onAcornSite()) return;
  const outcomes = new Map<string, Promise<Outcome>>();
  window.addEventListener("message", (event: MessageEvent<{ type?: string; code?: unknown }>) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type === ACORN_EXTENSION_PING) {
      void getAcornSession().then((session) =>
        post({
          type: ACORN_EXTENSION_HELLO,
          accountId: session?.profileId ?? "",
          supportBy: session?.supportBy ?? "",
        }),
      );
      return;
    }
    if (event.data?.type !== ACORN_SUPPORT_HANDOFF || typeof event.data.code !== "string") return;
    const code = event.data.code;
    if (!outcomes.has(code)) outcomes.set(code, redeem(code));
    void outcomes
      .get(code)
      ?.then((outcome) => post({ type: ACORN_SUPPORT_HANDOFF_ACK, ...outcome }));
  });
}
