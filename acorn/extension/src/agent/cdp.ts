/**
 * The tab's DevTools protocol session. The agent drives a page the way a person does,
 * with real mouse and keyboard events, and reads it with screenshots; both go through the
 * debugger the browser lends an extension. Chrome shows its "started debugging this
 * browser" bar while it is attached.
 */

/** The DevTools protocol version the debugger speaks. */
export const DEBUGGER_PROTOCOL_VERSION = "1.3";

/** What Chrome says when this extension already has a debugger on the tab. */
const ALREADY_ATTACHED = /already attached/i;

/** The part of a protocol session the agent uses, so the rest can be tested with a fake. */
export interface Cdp {
  /** Sends one protocol command and resolves with its result. */
  send<T = unknown>(method: string, params?: object): Promise<T>;
  /** Listens for protocol events (a file chooser opening, a dialog, a binding call). */
  onEvent(listener: (method: string, params: Record<string, unknown>) => void): () => void;
  /** Runs when the browser or the person ends the session (the bar's Cancel button). */
  onDetach(listener: (reason: string) => void): () => void;
  /** Lets go of the tab. Safe to call twice. */
  detach(): Promise<void>;
}

/**
 * Attaches to the tab. A debugger this extension already holds on it (the run's own, or a
 * typing helper's) is reused, and is left in place on detach, since it is not ours to end.
 */
export async function attachCdp(tabId: number): Promise<Cdp> {
  let owned = true;
  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  } catch (err) {
    if (!ALREADY_ATTACHED.test(err instanceof Error ? err.message : String(err))) throw err;
    owned = false;
  }

  const eventListeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  const detachListeners = new Set<(reason: string) => void>();
  let attached = true;

  const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (source.tabId !== tabId) return;
    for (const listener of eventListeners)
      listener(method, (params ?? {}) as Record<string, unknown>);
  };
  const onDetach = (source: chrome.debugger.Debuggee, reason: string) => {
    if (source.tabId !== tabId) return;
    attached = false;
    for (const listener of detachListeners) listener(reason);
  };
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);

  return {
    send: async <T>(method: string, params?: object) =>
      (await chrome.debugger.sendCommand({ tabId }, method, params)) as T,
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onDetach(listener) {
      detachListeners.add(listener);
      return () => detachListeners.delete(listener);
    },
    async detach() {
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      eventListeners.clear();
      detachListeners.clear();
      if (owned && attached) {
        attached = false;
        await chrome.debugger.detach({ tabId }).catch(() => undefined);
      }
    },
  };
}
