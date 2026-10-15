/**
 * Whether a run's tab is still fetching what it is about to draw. An app can sit
 * still in the DOM between drawing its shell and drawing the data it is fetching
 * (a form behind a route change); the network says it is not done yet.
 *
 * Read from the debugger session the run attaches to each tab (run-dialogs.ts):
 * only the requests that bring a page its content count (documents, fetch, XHR,
 * scripts), never images or fonts, and a request open longer than a long-lived
 * connection would be (polling, a stream) stops counting. Only request kinds and
 * times are kept: no address, header, or body.
 */

import { RUN_NETWORK_LONG_REQUEST_MS } from "./run-limits";

/** DevTools resource types whose requests bring a page its content. */
const CONTENT_REQUEST_TYPES = new Set(["Document", "XHR", "Fetch", "Script"]);

const REQUEST_STARTED = "Network.requestWillBeSent";
const REQUEST_FINISHED = new Set(["Network.loadingFinished", "Network.loadingFailed"]);

export interface TabNetwork {
  /** Content requests in flight, by request id: when each started. */
  inFlight: Map<string, number>;
  /** When a content request last started or ended. */
  lastActivity: number;
}

const tabs = new Map<number, TabNetwork>();

/**
 * How long the tab has had no content request in flight and started none, in
 * milliseconds. A tab the run does not watch (no debugger on it) is always quiet:
 * the page's own signals decide alone, as before.
 */
export function networkQuietFor(
  tabId: number,
  now = Date.now(),
  longRequestMs = RUN_NETWORK_LONG_REQUEST_MS,
): number {
  const state = tabs.get(tabId);
  return state ? quietFor(state, now, longRequestMs) : Number.POSITIVE_INFINITY;
}

/** How long one tab's network has been quiet; drops requests that turned long-lived. */
export function quietFor(
  state: TabNetwork,
  now: number,
  longRequestMs = RUN_NETWORK_LONG_REQUEST_MS,
): number {
  let quietSince = state.lastActivity;
  for (const [requestId, started] of state.inFlight) {
    if (now - started < longRequestMs) return 0;
    // Long-lived: it stops counting from the moment it became so.
    state.inFlight.delete(requestId);
    quietSince = Math.max(quietSince, started + longRequestMs);
  }
  return Math.max(0, now - quietSince);
}

interface RequestEvent {
  requestId?: string;
  type?: string;
}

export interface NetworkWatch {
  /** Watch this tab's requests; its debugger session must be attached already. */
  add(tabId: number): Promise<void>;
  /** Stop watching every tab. */
  stop(): void;
}

/** Follow a run's tabs' requests until stopped. */
export function watchNetwork(
  log: (event: string, data: Record<string, unknown>) => void,
): NetworkWatch {
  const watched = new Set<number>();

  const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    const tabId = source.tabId;
    if (tabId == null || !watched.has(tabId)) return;
    const state = tabs.get(tabId);
    if (!state) return;
    const event = (params ?? {}) as RequestEvent;
    if (!event.requestId) return;
    if (method === REQUEST_STARTED) {
      if (!CONTENT_REQUEST_TYPES.has(event.type ?? "")) return;
      state.inFlight.set(event.requestId, Date.now());
      state.lastActivity = Date.now();
    } else if (REQUEST_FINISHED.has(method) && state.inFlight.delete(event.requestId)) {
      state.lastActivity = Date.now();
    }
  };

  const forget = (tabId: number) => {
    watched.delete(tabId);
    tabs.delete(tabId);
  };
  // The debugging bar closed or the tab went away: the page's own signals decide again.
  const onDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId != null) forget(source.tabId);
  };

  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);

  return {
    async add(tabId) {
      if (watched.has(tabId)) return;
      try {
        await chrome.debugger.sendCommand({ tabId }, "Network.enable");
        watched.add(tabId);
        tabs.set(tabId, { inFlight: new Map(), lastActivity: Date.now() });
        log("network:watch", { tabId });
      } catch (err) {
        // No debugger on the tab (DevTools held it): the run goes on without it.
        log("network:unwatched", { error: err instanceof Error ? err.message : String(err) });
      }
    },
    stop() {
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      for (const tabId of [...watched]) forget(tabId);
    },
  };
}
