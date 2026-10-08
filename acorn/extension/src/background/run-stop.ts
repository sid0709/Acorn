/**
 * Each Run's stop switch, keyed by every tab the run has claimed (an Apply can move
 * a run to a tab it opened), so Stop works from whichever of its tabs is focused.
 */

const stops = new Map<number, AbortController>();

/** A new run on this tab: its signal aborts when the person presses Stop. */
export function beginRunStop(tabId: number): AbortController {
  const controller = new AbortController();
  stops.set(tabId, controller);
  return controller;
}

/** The run moved to another tab; Stop works from there too. */
export function claimRunStopTab(controller: AbortController, tabId: number): void {
  stops.set(tabId, controller);
}

/** The run ended: forget every tab it claimed. */
export function endRunStop(controller: AbortController): void {
  for (const [tabId, held] of stops) {
    if (held === controller) stops.delete(tabId);
  }
}

/** Stop the run working on this tab. False when no run is. */
export function stopRunOnTab(tabId: number): boolean {
  const controller = stops.get(tabId);
  if (!controller) return false;
  controller.abort();
  return true;
}
