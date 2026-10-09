/**
 * The browser's own dialogs (alert, confirm, prompt, leave-page) block the page
 * until someone answers them, and no script on the page can. While a run works on
 * a tab, Acorn attaches Chrome's debugger to it and answers each dialog: an alert
 * has only OK; anything else is decided by the caller (Jev reads its text).
 * Chrome shows its "started debugging this browser" bar while attached.
 */

/** The DevTools protocol version the debugger speaks. */
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const DIALOG_OPENING_EVENT = "Page.javascriptDialogOpening";
/** Longest dialog text the run log keeps. */
const DIALOG_LOG_CHARS = 200;

/** The dialog kinds the browser reports. */
export const PAGE_DIALOG = {
  alert: "alert",
  confirm: "confirm",
  prompt: "prompt",
  beforeUnload: "beforeunload",
} as const;

export type PageDialogKind = (typeof PAGE_DIALOG)[keyof typeof PAGE_DIALOG];

export interface PageDialog {
  kind: PageDialogKind;
  message: string;
  url: string;
  /** What a prompt offers as its answer; kept when the prompt is accepted. */
  defaultPrompt: string;
}

/** Accept (OK, Leave) or dismiss (Cancel, Stay) one dialog on one tab. */
export type DialogDecider = (dialog: PageDialog, tabId: number) => Promise<boolean>;
export type DialogLog = (event: string, data: Record<string, unknown>) => void;

export interface DialogWatch {
  /** Start answering dialogs on this tab (the run moved to it). */
  add(tabId: number): Promise<void>;
  /** Stop answering and let go of every tab. */
  stop(): Promise<void>;
}

interface DialogOpening {
  type?: string;
  message?: string;
  url?: string;
  defaultPrompt?: string;
}

function dialogKind(type: string | undefined): PageDialogKind {
  const kinds = Object.values(PAGE_DIALOG) as string[];
  return (kinds.includes(type ?? "") ? type : PAGE_DIALOG.confirm) as PageDialogKind;
}

/** Answer the browser dialogs a run's tabs open, until stopped. */
export function watchPageDialogs(decide: DialogDecider, log: DialogLog): DialogWatch {
  const attached = new Set<number>();

  const answer = async (tabId: number, dialog: PageDialog) => {
    let accept = dialog.kind === PAGE_DIALOG.alert;
    if (!accept) {
      // A dialog that could not be decided is dismissed: Cancel never sends anything.
      accept = await decide(dialog, tabId).catch(() => false);
    }
    log("dialog:answer", { kind: dialog.kind, accept });
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.handleJavaScriptDialog", {
        accept,
        ...(dialog.kind === PAGE_DIALOG.prompt ? { promptText: dialog.defaultPrompt } : {}),
      });
    } catch (err) {
      log("dialog:answer-failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    const tabId = source.tabId;
    if (tabId == null || !attached.has(tabId) || method !== DIALOG_OPENING_EVENT) return;
    const opening = (params ?? {}) as DialogOpening;
    const dialog: PageDialog = {
      kind: dialogKind(opening.type),
      message: opening.message ?? "",
      url: opening.url ?? "",
      defaultPrompt: opening.defaultPrompt ?? "",
    };
    log("dialog:open", { kind: dialog.kind, message: dialog.message.slice(0, DIALOG_LOG_CHARS) });
    void answer(tabId, dialog);
  };

  const onDetach = (source: chrome.debugger.Debuggee, reason: string) => {
    if (source.tabId == null || !attached.delete(source.tabId)) return;
    // The person closed Chrome's debugging bar, or the tab went away.
    log("dialog:detached", { reason });
  };

  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);

  return {
    async add(tabId) {
      if (attached.has(tabId)) return;
      try {
        await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
        attached.add(tabId);
        // Enabling Page also reports a dialog that is already open.
        await chrome.debugger.sendCommand({ tabId }, "Page.enable");
        log("dialog:watch", { tabId });
      } catch (err) {
        // DevTools open on the tab, or another debugger: the run goes on without it.
        log("dialog:unwatched", { error: err instanceof Error ? err.message : String(err) });
      }
    },
    async stop() {
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      const tabs = [...attached];
      attached.clear();
      await Promise.all(
        tabs.map((tabId) => chrome.debugger.detach({ tabId }).catch(() => undefined)),
      );
    },
  };
}
