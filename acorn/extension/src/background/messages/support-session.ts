import { DEFAULT_ACORN_WEB_URL, acornSupportSignIn } from "../../auth/acorn-auth";
import { connectSocket } from "../socket-connection";
import type { RuntimeMessage, SendResponse } from "./shared";

function webOrigin(): string {
  try {
    return new URL(DEFAULT_ACORN_WEB_URL).origin;
  } catch {
    return "";
  }
}

/** Only the Acorn site's own top frame may hand the extension a support sign-in. */
export function isAcornSiteSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.frameId !== 0 || !sender.url) return false;
  try {
    return new URL(sender.url).origin === webOrigin();
  } catch {
    return false;
  }
}

/** Redeems the site's support code and switches the extension to that session. */
export function handleSupportHandoff(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  if (!isAcornSiteSender(sender) || typeof message.code !== "string") {
    sendResponse({ ok: false, error: "Support sign-in only works from the Acorn site." });
    return;
  }
  void (async () => {
    const result = await acornSupportSignIn(message.code as string);
    if (!result.ok) {
      sendResponse({ ok: false, error: result.error });
      return;
    }
    await connectSocket().catch(() => undefined);
    sendResponse({ ok: true });
  })();
}
