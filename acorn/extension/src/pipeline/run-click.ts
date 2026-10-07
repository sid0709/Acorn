import { sendTabMessage } from "../tab-messaging";
import { MSG, type PageProbe } from "../types";

import {
  RUN_SETTLE_MAX_MS,
  RUN_SETTLE_MIN_MS,
  RUN_SETTLE_POLL_MS,
  RUN_PROBE_TIMEOUT_MS,
  RUN_SETTLE_UNCHANGED_MS,
  RUN_TAB_LOAD_MAX_MS,
} from "./run-limits";
import { snapshotPage, type PageSnapshot } from "./run-page";

export interface ClickResult {
  ok: boolean;
  error?: string;
  tag?: string;
  text?: string;
  /** The control exists but refuses clicks: the page is waiting on something. */
  disabled?: boolean;
}

/** Press a control the run picked, in the frame it was read from. */
export function clickControl(
  tabId: number,
  frameId: number | null,
  nodeId: number,
): Promise<ClickResult> {
  return sendTabMessage<ClickResult>(
    tabId,
    { type: MSG.CLICK_CONTROL, nodeId },
    frameId ?? undefined,
  );
}

/** A cheap look at the page (fields, address, refusal marks); null when no frame answers. */
export async function probePage(tabId: number, frameId: number | null): Promise<PageProbe | null> {
  const res = await sendTabMessage<{ ok?: boolean; probe?: PageProbe }>(
    tabId,
    { type: MSG.PAGE_PROBE },
    frameId ?? undefined,
    RUN_PROBE_TIMEOUT_MS,
  );
  return res?.ok && res.probe ? res.probe : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Tabs the page opens while a click is in flight; "Apply" links often open one. */
export function watchOpenedTabs(openerTabId: number): {
  opened: () => number | null;
  stop: () => void;
} {
  let found: number | null = null;
  const listener = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId === openerTabId && tab.id != null && found == null) found = tab.id;
  };
  chrome.tabs.onCreated.addListener(listener);
  return {
    opened: () => found,
    stop: () => chrome.tabs.onCreated.removeListener(listener),
  };
}

async function waitForTabComplete(tabId: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < RUN_TAB_LOAD_MAX_MS) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return;
    }
    await sleep(RUN_SETTLE_POLL_MS);
  }
}

export type SettleHow = "new-tab" | "navigated" | "changed" | "unchanged";

export interface SettleResult {
  tabId: number;
  how: SettleHow;
  /** The page after the click; set unless the run has not read it yet. */
  snapshot: PageSnapshot;
}

/**
 * Wait for a click to take effect: a new tab, a navigation, or a change in which
 * step the page shows. A page that shows the same step after the wait is
 * `unchanged`, and its snapshot carries any errors the page flagged.
 *
 * Polls a cheap probe and reads the whole page only when the probe moves: the
 * fields change, or the page puts up new refusal marks, which is its answer to
 * the click (no need to wait out the rest of the window).
 */
export async function settleAfterClick(args: {
  tabId: number;
  frameId: number | null;
  before: { url: string; signature: string };
  /** The probe taken right before the click; null when the frame did not answer. */
  beforeProbe: PageProbe | null;
  watcher: ReturnType<typeof watchOpenedTabs>;
}): Promise<SettleResult> {
  const { before, watcher } = args;
  let baseline = args.beforeProbe;
  let tabId = args.tabId;
  const started = Date.now();
  let how: SettleHow = "unchanged";

  while (Date.now() - started < RUN_SETTLE_MAX_MS) {
    await sleep(RUN_SETTLE_POLL_MS);
    const elapsed = Date.now() - started;

    const opened = watcher.opened();
    if (opened != null) {
      tabId = opened;
      how = "new-tab";
      break;
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && (tab.status === "loading" || (tab.url && tab.url !== before.url))) {
      how = "navigated";
      break;
    }
    if (elapsed < RUN_SETTLE_MIN_MS) continue;
    const probe = await probePage(tabId, args.frameId);
    const moved =
      !probe || !baseline || probe.fields !== baseline.fields || probe.url !== baseline.url;
    const refused = Boolean(probe && baseline && probe.refusals > baseline.refusals);
    const timedOut = elapsed >= RUN_SETTLE_UNCHANGED_MS;
    if (!moved && !refused && !timedOut) continue;
    const snapshot = await snapshotPage(tabId, { form: true, frameId: args.frameId });
    if (snapshot.signature !== before.signature) return { tabId, how: "changed", snapshot };
    if (refused || timedOut) return { tabId, how: "unchanged", snapshot };
    baseline = probe;
  }

  await waitForTabComplete(tabId);
  const snapshot = await snapshotPage(tabId, { form: true });
  return { tabId, how, snapshot };
}
