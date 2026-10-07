import { MSG } from "../../../types";

/** The writer's short answer for a dropdown field, to type as a search query; null on failure. */
export async function estimateOptionAnswer(fieldLabel: string | null): Promise<string | null> {
  if (!fieldLabel?.trim()) return null;
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: MSG.ESTIMATE_OPTION, fieldLabel },
        (response: { ok?: boolean; answer?: string } | undefined) => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve(null);
            return;
          }
          resolve(response.answer?.trim() || null);
        },
      );
    } catch {
      resolve(null);
    }
  });
}
