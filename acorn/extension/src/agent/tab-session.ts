/**
 * The agent's hold on one tab: the debugger session, the overlay, and what the page says
 * to the browser while it works (a dialog opening, the Stop button pressed, the person
 * ending the debugging). Opening and closing it are one place, so a run that moves to
 * another tab hands over cleanly.
 */

import { attachCdp, type Cdp } from "./cdp";
import { OVERLAY_STOP_BINDING, Overlay } from "./overlay";

/** The person ended the debugger from Chrome's bar. */
const DETACH_BY_PERSON = "canceled_by_user";
/** The tab itself is gone. */
const DETACH_TARGET_CLOSED = "target_closed";

export interface AgentTab {
  tabId: number;
  cdp: Cdp;
  overlay: Overlay;
  /** Things the page did that a screenshot cannot show; taken (and cleared) with takeNotes. */
  takeNotes(): string[];
  close(): Promise<void>;
}

export interface TabHooks {
  /** The person pressed Stop on the page, or ended the debugging. */
  onStop(): void;
  /** The tab closed under the run. */
  onTabClosed(): void;
}

type DialogParams = { type?: string; message?: string; defaultPrompt?: string };

/** The commands that make a session ready, each tried on its own: an older browser lacks some. */
async function prepare(cdp: Cdp): Promise<void> {
  const commands: [string, object?][] = [
    ["Page.enable"],
    ["DOM.enable"],
    ["Runtime.enable"],
    // Hand the run the file picker a click opens, instead of the system dialog.
    ["Page.setInterceptFileChooserDialog", { enabled: true }],
    // A tab in the background still draws, takes focus, and answers screenshots.
    ["Emulation.setFocusEmulationEnabled", { enabled: true }],
  ];
  for (const [method, params] of commands) {
    await cdp.send(method, params).catch(() => undefined);
  }
}

export async function openAgentTab(
  tabId: number,
  hooks: TabHooks,
  label: string,
): Promise<AgentTab> {
  const cdp = await attachCdp(tabId);
  const notes: string[] = [];
  const overlay = new Overlay(cdp);
  try {
    await prepare(cdp);
  } catch (err) {
    await cdp.detach();
    throw err;
  }

  const stopEvents = cdp.onEvent((method, params) => {
    if (method === "Runtime.bindingCalled" && params.name === OVERLAY_STOP_BINDING) hooks.onStop();
    if (method === "Page.javascriptDialogOpening") {
      const dialog = params as DialogParams;
      notes.push(
        `A ${dialog.type ?? "browser"} dialog said "${dialog.message ?? ""}" and was accepted.`,
      );
      void cdp
        .send("Page.handleJavaScriptDialog", {
          accept: true,
          promptText: dialog.defaultPrompt ?? "",
        })
        .catch(() => undefined);
    }
  });
  const stopDetach = cdp.onDetach((reason) => {
    if (reason === DETACH_BY_PERSON) hooks.onStop();
    else if (reason === DETACH_TARGET_CLOSED) hooks.onTabClosed();
  });

  await overlay.start(label);
  return {
    tabId,
    cdp,
    overlay,
    takeNotes: () => notes.splice(0, notes.length),
    async close() {
      stopEvents();
      stopDetach();
      await overlay.stop();
      await cdp.detach();
    },
  };
}
