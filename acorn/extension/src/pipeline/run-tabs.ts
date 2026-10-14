/**
 * Which tab a run goes on in when the one it works in closes under it: a tab that
 * one opened (the site moved the application there), the newest first; otherwise
 * the run's own latest tab that is still open (the application, after a detour).
 */

/** What the run needs to know about an open tab. */
export interface OpenTab {
  id?: number;
  openerTabId?: number;
  lastAccessed?: number;
}

export function successorTab(
  closed: number,
  open: readonly OpenTab[],
  runTabs: readonly number[],
): number | null {
  const opened = open
    .filter((tab) => tab.id != null && tab.id !== closed && tab.openerTabId === closed)
    .sort((a, b) => (b.lastAccessed ?? b.id ?? 0) - (a.lastAccessed ?? a.id ?? 0));
  if (opened[0]?.id != null) return opened[0].id;
  const stillOpen = new Set(open.map((tab) => tab.id));
  for (const id of [...runTabs].reverse()) {
    if (id !== closed && stillOpen.has(id)) return id;
  }
  return null;
}
