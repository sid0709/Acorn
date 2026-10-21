import { MSG } from "../types";

import { pushAcornNotice } from "./acorn-notice";
import { sendMessage } from "./runtime";

/** What the person asks to see on the page: a field of the run's control list at its place, or a place alone (CSS pixels). */
export type ShowTarget = { control?: string; y: number };

/**
 * Scrolls the tab's page to a field or a place and rings it (`field-spotlight.ts`). The service worker
 * refuses while a run works on the tab; the card does not offer it then, and says so if it is asked anyway.
 */
export async function showOnPage(tabId: number, target: ShowTarget): Promise<void> {
  const res = await sendMessage<{ ok?: boolean; error?: string }>({
    type: MSG.SHOW_ON_PAGE,
    tabId,
    ...target,
  });
  if (res.error) {
    pushAcornNotice({
      kind: "error",
      title: "Couldn’t show it on the page",
      detail: res.error,
      tabId,
    });
  }
}
