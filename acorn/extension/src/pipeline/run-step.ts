import { CONTROL_ROLE, type ControlRole } from "@acorn/shared/run-types";

import type { SettleHow } from "./run-click";

/** What the run knew about a page the last time it looked. */
export interface SeenPage {
  url: string;
  signature: string;
  /** Fields the page marks invalid; only the page in view needs it. */
  flagged?: number;
}

/**
 * Clicks that work inside the step: what the page still requires (an entry to
 * add, a statement to open), and the save of what such a click opened. They change
 * the page's fields, never the step the application is on.
 */
const IN_STEP_ROLES = new Set<ControlRole>([CONTROL_ROLE.resolve, CONTROL_ROLE.commit]);

/** A page address without query or fragment: the same step keeps it while its form changes. */
export function addressOf(url: string): string {
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
 * file, an answer reveals follow-up questions — and so is the page after a click
 * that works inside the step (`role`): an entry form it opened, or saved and closed.
 */
export function isNewStep(args: {
  previous: SeenPage | null;
  page: SeenPage;
  /** How the click before this look settled; null when no click came before it. */
  settled: SettleHow | null;
  /** What that click did; a click inside the step keeps the step at the same address. */
  role?: ControlRole | null;
}): boolean {
  const { previous, page, settled, role } = args;
  if (!previous) return true;
  if (addressOf(page.url) !== addressOf(previous.url)) return true;
  if (settled == null) return false;
  if (settled === "unchanged") return false;
  if (role != null && IN_STEP_ROLES.has(role) && settled !== "new-tab") return false;
  // The site drew the same form again at the same address and now refuses fields
  // in it (a form posted back to itself): the click did not move the application on.
  if (settled === "navigated" && page.signature === previous.signature && (page.flagged ?? 0) > 0) {
    return false;
  }
  return settled === "navigated" || settled === "new-tab" || page.signature !== previous.signature;
}
