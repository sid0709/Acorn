import type { SettleHow } from "./run-click";

/** What the run knew about a page the last time it looked. */
export interface SeenPage {
  url: string;
  signature: string;
}

/** A page address without query or fragment: the same step keeps it while its form changes. */
function addressOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Whether the page in view is a new step of the application. Only a click can move
 * the application on: a click the page answered (a changed step, a navigation, a
 * new tab) is a new step, and so is a new address. A page the run looked at again
 * after its own work (a fill, a refill, a repair) is the same step, however much
 * that work changed its fields — an upload swaps its file input for the attached
 * file, an answer reveals follow-up questions.
 */
export function isNewStep(args: {
  previous: SeenPage | null;
  page: SeenPage;
  /** How the click before this look settled; null when no click came before it. */
  settled: SettleHow | null;
}): boolean {
  const { previous, page, settled } = args;
  if (!previous) return true;
  if (addressOf(page.url) !== addressOf(previous.url)) return true;
  if (settled == null) return false;
  if (settled === "unchanged") return false;
  return settled === "navigated" || settled === "new-tab" || page.signature !== previous.signature;
}
