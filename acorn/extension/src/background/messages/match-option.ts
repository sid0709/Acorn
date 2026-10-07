import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";
import type { MatchOptionRequest, MatchOptionResponse } from "../../types";
import type { RuntimeMessage, SendResponse } from "./shared";

export function handleMatchOption(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  const incoming = message.payload as MatchOptionRequest;
  const usageTabId = sender.tab?.id;
  (async () => {
    try {
      const base = await getAcornApiUrl();
      const payload: Record<string, unknown> = {
        intendedValue: incoming.intendedValue,
        options: incoming.options.filter(
          (opt): opt is string => typeof opt === "string" && opt.trim().length > 0,
        ),
      };
      if (typeof incoming.fieldLabel === "string" && incoming.fieldLabel.trim()) {
        payload.fieldLabel = incoming.fieldLabel;
      }
      if (typeof incoming.typedQuery === "string" && incoming.typedQuery.trim()) {
        payload.typedQuery = incoming.typedQuery;
      }
      if (incoming.allowNotListed) {
        payload.allowNotListed = true;
      }
      if (incoming.multiple) {
        payload.multiple = true;
      }
      const res = await fetch(`${base}/acorn/match-option`, {
        method: "POST",
        headers: await authHeaders(usageTabId),
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as MatchOptionResponse;
      if (!res.ok) {
        sendResponse({
          ok: false,
          matched_option: null,
          error: data.error || `match-option failed: ${res.status}`,
        } satisfies MatchOptionResponse);
        return;
      }
      // A null match (only with allowNotListed) means "search further"; fallback_option is the best listed pick.
      const reply: MatchOptionResponse = { ...data, ok: data.ok !== false };
      sendResponse(reply);
    } catch (err) {
      sendResponse({
        ok: false,
        matched_option: null,
        error: err instanceof Error ? err.message : String(err),
      } satisfies MatchOptionResponse);
    }
  })();
}
