/**
 * The guard that keeps files coming from this computer only. The applicant has not allowed an
 * online file source (a cloud drive, a file-sharing service, signing in to one), so no click may
 * reach one. The prompt says so, but a model can slip; so, before each click, the control under
 * the pointer is read from the page (what it says of itself, nothing more) and the server's
 * decision model judges it. And after a click, a window or a cross-origin frame that opened is
 * judged the same way and closed if it is one. There is no list of services here: the model
 * says what a control or page is.
 *
 * The same judgment keeps the run from signing in through another service's account (single
 * sign-on): the applicant's own e-mail and password are used, so a control or window that starts
 * one is refused or closed.
 *
 * A control the model is unsure about is blocked, and so is a control inside a file-upload
 * component when it cannot be checked. A window or frame that cannot be checked is let be.
 */

import {
  VET_CAUSE,
  type AgentVetTarget,
  type AgentVetVerdict,
  type VetCause,
} from "@acorn/shared/agent-contract";

import type { Cdp } from "./cdp";

/** What a click is told when it is refused. */
export const BLOCKED_MESSAGE =
  "blocked: that control uses an online file source or a place to paste a document, and the applicant has not allowed those. " +
  "Attach a file with upload, at the button that opens this computer's file picker.";

/** What a click is told when it would sign in through another service's account. */
export const SIGN_ON_BLOCKED_MESSAGE =
  "blocked: that control signs in through another service's account, and Acorn never does. " +
  "Use the employer's own e-mail and password form, or continue as a guest if the page offers it.";

/** What a window that a click opened is told when it is closed. */
const WINDOW_CLOSED_NOTES: Record<VetCause, string> = {
  [VET_CAUSE.onlineSource]:
    "A click opened a window for an online file source or a sign-in to one, and Acorn closed it. Acorn never uses those: attach a file with upload, at the button that opens this computer's file picker.",
  [VET_CAUSE.singleSignOn]:
    "A click opened another service's sign-in, and Acorn closed it. Acorn never signs in that way: use the employer's own e-mail and password form, or continue as a guest if the page offers it.",
};

/** The refusal for a control, by why it was refused. */
export function blockedMessage(cause?: VetCause): string {
  return cause === VET_CAUSE.singleSignOn ? SIGN_ON_BLOCKED_MESSAGE : BLOCKED_MESSAGE;
}

/** The note for the model when a window was closed, by why. */
export function windowClosedNote(cause?: VetCause): string {
  return WINDOW_CLOSED_NOTES[cause ?? VET_CAUSE.onlineSource];
}

/** The longest excerpt of a new window's text that is sent. */
export const EXCERPT_CHARS = 400;

/** Runs in the page: describes the control at a point, looking through shadow roots and same-origin frames. */
export function targetScript(x: number, y: number): string {
  return `((px, py) => {
    const FIELD = new Set(["text","email","tel","number","password","search","url","date","datetime-local","time","month","week","checkbox","radio","range","color"]);
    const clip = (t, n) => String(t == null ? "" : t).replace(/\\s+/g, " ").trim().slice(0, n || 200);
    let el = document.elementFromPoint(px, py);
    let ox = px, oy = py;
    for (let depth = 0; el && depth < 8; depth += 1) {
      if (el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(ox, oy);
        if (inner && inner !== el) { el = inner; continue; }
      }
      if (el.tagName === "IFRAME") {
        try {
          const inside = el.contentDocument;
          if (inside) {
            const box = el.getBoundingClientRect();
            ox -= box.left; oy -= box.top;
            const inner = inside.elementFromPoint(ox, oy);
            if (inner) { el = inner; continue; }
          }
        } catch (error) { /* a frame of another origin: it is described as a frame */ }
      }
      break;
    }
    if (!el) return null;
    const control = el.closest("button,a,[role=button],[role=link],[role=menuitem],[role=option],label,input,select,summary") || el;
    const tag = control.tagName.toLowerCase();
    const type = (control.getAttribute("type") || "").toLowerCase();
    const named = (node) => {
      const ids = (node.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean)
        .map((id) => (node.ownerDocument.getElementById(id) || {}).textContent).filter(Boolean).join(" ");
      return node.getAttribute("aria-label") || ids || (node.labels && node.labels[0] && node.labels[0].textContent) || "";
    };
    const alts = [];
    for (const image of [control, ...control.querySelectorAll("img[alt],svg title,[role=img][aria-label]")].slice(0, 5)) {
      const text = image.getAttribute && (image.getAttribute("alt") || image.getAttribute("aria-label")) || (image.tagName === "title" ? image.textContent : "");
      if (text) alts.push(text);
    }
    const tokens = [];
    for (let node = control, up = 0; node && up < 3; node = node.parentElement, up += 1) {
      tokens.push(node.id || "", node.getAttribute("class") || "", node.getAttribute("data-provider") || "", node.getAttribute("data-source") || "");
    }
    // A file component is the small group around a file input, not the whole form that holds it.
    let inFile = false;
    for (let node = control, up = 0; node && up < 4; up += 1) {
      if (node.tagName === "FORM" || node.tagName === "BODY" || node.tagName === "HTML") break;
      if (node.querySelector && node.querySelector('input[type="file"]')) { inFile = true; break; }
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    const link = control.closest("a");
    let linkHost = "";
    try { linkHost = link && link.href ? new URL(link.href, location.href).hostname : ""; } catch (error) { /* no host */ }
    if (tag === "iframe") { try { linkHost = new URL(control.src, location.href).hostname; } catch (error) { /* no host */ } }
    const own = tag === "input" || tag === "textarea" || tag === "select";
    return {
      tag, type, role: control.getAttribute("role") || "",
      text: clip(own ? (control.value || control.placeholder || "") : (control.innerText || control.textContent)),
      label: clip(named(control)), title: clip(control.getAttribute("title")),
      alt: clip(alts.join(" | ")), linkHost, idClass: clip(tokens.filter(Boolean).join(" "), 240),
      inFileComponent: inFile,
      formField: (tag === "input" && FIELD.has(type || "text")) || tag === "textarea" || tag === "select",
    };
  })(${Number(x)}, ${Number(y)})`;
}

type Described = Omit<AgentVetTarget, "kind"> & { formField?: boolean };

/** Describes the control at a point (CSS pixels), or null when nothing is there or the page cannot say. */
export async function describeTargetAt(cdp: Cdp, x: number, y: number): Promise<Described | null> {
  try {
    const answer = await cdp.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: targetScript(x, y),
      returnByValue: true,
    });
    const value = answer.result?.value;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export interface GuardVerdict {
  blocked: boolean;
  reason?: string;
  cause?: VetCause;
}

export interface ClickGuardDeps {
  /** The session of the tab the run is in now (a run may move to another tab). */
  cdp: () => Cdp;
  /** Asks the server's decision model. */
  vet: (target: AgentVetTarget) => Promise<AgentVetVerdict>;
  /** The page the click is on, for the description. */
  pageUrl: () => string;
}

/** The guard for one run: it remembers what it has already judged, and never throws. */
export function createClickGuard(
  deps: ClickGuardDeps,
): (x: number, y: number) => Promise<GuardVerdict> {
  const judged = new Map<string, Promise<GuardVerdict>>();
  return async (x, y) => {
    try {
      const described = await describeTargetAt(deps.cdp(), x, y);
      if (!described) return { blocked: false };
      const { formField, ...rest } = described;
      // A plain form field is typed into, never a way to bring in a file.
      if (formField && !rest.inFileComponent) return { blocked: false };
      const key = JSON.stringify(rest);
      let verdict = judged.get(key);
      if (!verdict) {
        verdict = deps
          .vet({ kind: "control", ...rest, pageUrl: deps.pageUrl() })
          .then((answer): GuardVerdict => ({
            blocked: answer.blocked,
            reason: answer.reason,
            cause: answer.cause,
          }))
          // The server could not be asked: only a control in a file-upload component is refused.
          .catch((): GuardVerdict => ({
            blocked: Boolean(rest.inFileComponent),
            reason: "could not be checked",
          }));
        judged.set(key, verdict);
      }
      return await verdict;
    } catch {
      return { blocked: false };
    }
  };
}

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
