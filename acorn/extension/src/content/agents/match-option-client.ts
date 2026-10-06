import { MSG, type MatchOptionRequest, type MatchOptionResponse } from "../../types";

/**
 * The matcher must always name an option, so a weak pick comes back with low
 * confidence ("no option means none", 0.08) instead of null. Below this, leave it unset.
 */
export const MATCH_OPTION_MIN_CONFIDENCE = 0.5;

/** The matcher's option when it actually believes it, else null. */
export function confidentMatchedOption(response: MatchOptionResponse): string | null {
  const confidence = typeof response.confidence === "number" ? response.confidence : 0;
  if (typeof response.matched_option !== "string" || !response.matched_option) return null;
  return confidence >= MATCH_OPTION_MIN_CONFIDENCE ? response.matched_option : null;
}

/** Ask ai-backend (via service worker) which visible option matches the intended value. */
export async function askAiMatchOption(request: MatchOptionRequest): Promise<MatchOptionResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: MSG.MATCH_OPTION, payload: request },
        (response: MatchOptionResponse | undefined) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              matched_option: null,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          resolve(response ?? { ok: false, matched_option: null, error: "No response" });
        },
      );
    } catch (err) {
      resolve({
        ok: false,
        matched_option: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
