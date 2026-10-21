/**
 * The guard that closes what a slip opened. The applicant has not allowed an online file source (a
 * cloud drive, a file-sharing service, signing in to one), another service's sign-in, or an autofill
 * from anything but a résumé file; the prompt says so, and the model that drives the run sees the
 * screen and chooses what to click. Nothing here judges a control before it is clicked: until 2.10.0
 * the control under the pointer was described from the page (its text, id and classes) and the
 * server's decision model judged the description, and that misread the "Indeed", "Linkedin" and
 * "Glassdoor" options of a "How did you learn about this job?" list as an autofill from those
 * services; the refusal was cached for the run, one click was refused 33 times, and the fields below
 * it were never reached. After a click, a window or a cross-origin frame that opened is an outcome,
 * not a guess: it is judged by what it is (address, title, text) and closed if it is more likely than
 * not such a source, sign-in or autofill, and the model is told. There is no list of services here:
 * the decision model says what a page is, and nothing that cannot be checked is closed.
 */

import {
  VET_CAUSE,
  type AgentVetTarget,
  type AgentVetVerdict,
  type VetCause,
} from "@acorn/shared/agent-contract";

import type { Cdp } from "./cdp";

/** What a window that a click opened is told when it is closed. */
const WINDOW_CLOSED_NOTES: Record<VetCause, string> = {
  [VET_CAUSE.onlineSource]:
    "A click opened a window for an online file source or a sign-in to one, and Acorn closed it. Acorn never uses those: attach a file with upload, at the button that opens this computer's file picker.",
  [VET_CAUSE.singleSignOn]:
    "A click opened another service's sign-in, and Acorn closed it. Acorn never signs in that way: use the employer's own e-mail and password form, or continue as a guest if the page offers it.",
  [VET_CAUSE.otherAutofill]:
    "A click opened a page that fills the application from a saved profile or another service, and Acorn closed it. Only a résumé file from this computer may fill the form: fill the fields from the applicant's details.",
};

/** The note for the model when a window was closed, by why. */
export function windowClosedNote(cause?: VetCause): string {
  return WINDOW_CLOSED_NOTES[cause ?? VET_CAUSE.onlineSource];
}

/** The longest excerpt of a new window's text that is sent. */
export const EXCERPT_CHARS = 400;

/** The address, title and start of the text of a window a click opened. */
export async function describeWindow(tabId: number, pageUrl: string): Promise<AgentVetTarget> {
  const tab = await chrome.tabs.get(tabId);
  let excerpt = "";
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (limit: number) => String(document.body?.innerText ?? "").slice(0, limit),
      args: [EXCERPT_CHARS],
    });
    excerpt = typeof first?.result === "string" ? first.result : "";
  } catch {
    // A page the extension cannot script is described by its address and title.
  }
  return { kind: "window", url: tab.url ?? "", windowTitle: tab.title ?? "", excerpt, pageUrl };
}

/**
 * Runs in the page: the address of every frame in it that a person could see, in shadow roots and
 * same-origin frames too. A hidden frame (a one-pixel proxy a page loads for its own scripts)
 * cannot show a chooser or a sign-in, so it is not asked about.
 */
const FRAMES_SCRIPT = `(() => {
  const found = [];
  const visible = (frame) => {
    const box = frame.getBoundingClientRect();
    const view = frame.ownerDocument.defaultView;
    const style = view ? view.getComputedStyle(frame) : null;
    return box.width >= 40 && box.height >= 40 && (!style || (style.display !== "none" && style.visibility !== "hidden"));
  };
  const visit = (root, depth) => {
    if (depth > 6) return;
    for (const frame of root.querySelectorAll("iframe,frame")) {
      if (visible(frame)) found.push(frame.src || frame.getAttribute("src") || "");
      try { if (frame.contentDocument) visit(frame.contentDocument, depth + 1); } catch (error) { /* another origin */ }
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
  };
  visit(document, 0);
  return { origin: location.origin, frames: found };
})()`;

/** Runs in the page: removes every frame with this address. */
function removeFramesScript(src: string): string {
  return `((target) => {
    const visit = (root, depth) => {
      if (depth > 6) return;
      for (const frame of Array.from(root.querySelectorAll("iframe,frame"))) {
        if ((frame.src || frame.getAttribute("src") || "") === target) frame.remove();
        else { try { if (frame.contentDocument) visit(frame.contentDocument, depth + 1); } catch (error) { /* another origin */ } }
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
    };
    visit(document, 0);
  })(${JSON.stringify(src)})`;
}

export interface FrameWatchDeps {
  cdp: Cdp;
  vet: (target: AgentVetTarget) => Promise<AgentVetVerdict>;
  pageUrl: () => string;
  /** Called with a note for the model when a frame was closed. */
  onClosed: (note: string) => void;
}

/**
 * Looks at the frames of another origin that the page now holds, judges each new one, and
 * removes one that is an online file source. The frames' events are not enough on their own: a
 * frame of another site may live in another process, and its navigation is then reported to a
 * session this one is not attached to. Returns a function that does the sweep.
 */
export function createFrameSweep(deps: FrameWatchDeps): () => Promise<void> {
  const seen = new Set<string>();
  return async () => {
    try {
      const answer = await deps.cdp.send<{
        result?: { value?: { origin?: string; frames?: string[] } };
      }>("Runtime.evaluate", { expression: FRAMES_SCRIPT, returnByValue: true });
      const value = answer.result?.value;
      for (const src of value?.frames ?? []) {
        if (!src || seen.has(src)) continue;
        let origin = "";
        try {
          const parsed = new URL(src);
          if (!/^https?:$/.test(parsed.protocol)) continue;
          origin = parsed.origin;
        } catch {
          continue;
        }
        if (origin === value?.origin) continue;
        seen.add(src);
        let verdict: AgentVetVerdict;
        try {
          verdict = await deps.vet({ kind: "frame", url: src, pageUrl: deps.pageUrl() });
        } catch {
          continue; // a frame that cannot be judged is let be
        }
        if (!verdict.blocked) continue;
        await deps.cdp.send("Runtime.evaluate", { expression: removeFramesScript(src) });
        deps.onClosed(frameClosedNote(src, verdict.cause));
      }
    } catch {
      // The page is mid-navigation, or has nothing to say.
    }
  };
}

function frameClosedNote(url: string, cause?: VetCause): string {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // keep the address as it is
  }
  if (cause === VET_CAUSE.singleSignOn) {
    return `A frame from ${host} offered another service's sign-in, and Acorn closed it. Acorn never signs in that way: use the employer's own e-mail and password form, or continue as a guest if the page offers it.`;
  }
  if (cause === VET_CAUSE.otherAutofill) {
    return `A frame from ${host} offered to fill the application from a saved profile or another service, and Acorn closed it. Only a résumé file from this computer may fill the form: fill the fields from the applicant's details.`;
  }
  return `A frame from ${host} showed an online file source or sign-in, and Acorn closed it. Acorn never uses those: attach a file with upload.`;
}

/**
 * Runs the sweep when the browser reports a frame navigating in the page, so a frame an online
 * file source draws is judged without waiting for the next click or look. Returns a function
 * that stops listening.
 */
export function watchFrameEvents(cdp: Cdp, sweep: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = cdp.onEvent((method, params) => {
    if (
      method !== "Page.frameNavigated" ||
      !(params as { frame?: { parentId?: string } }).frame?.parentId
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => void sweep(), 150);
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}
