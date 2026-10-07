import { requestQaAnswer } from "../../pipeline/api/qa";
import type { RuntimeMessage, SendResponse } from "./shared";

/** How the writer is asked for a dropdown answer it can type as a search query. */
function estimateQuestion(fieldLabel: string): string {
  return (
    `Form dropdown "${fieldLabel}". Which option should the applicant choose? ` +
    "Reply with only the option text, as short as it appears in a list (for example a country, state, city, school, or company name)."
  );
}

/** Leftover long dropdowns: the normal model estimates the answer; Jev picks once typing narrows the list. */
export function handleEstimateOption(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  const fieldLabel = String(message.fieldLabel || "").trim();
  if (!fieldLabel) {
    sendResponse({ ok: false, error: "fieldLabel is required" });
    return;
  }
  requestQaAnswer({ question: estimateQuestion(fieldLabel) }, undefined, sender.tab?.id)
    .then((answer) => sendResponse({ ok: true, answer }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
}
