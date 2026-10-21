/**
 * What a screenshot cannot show: the control that has keyboard focus, with its value, its
 * label, its options, and what the page says is wrong with it. The page answers; nothing
 * here decides what the control is for.
 */

import type { Cdp } from "./cdp";
import type { AgentFocus, AgentOpenList, AgentRect } from "@acorn/shared/agent-contract";

/** The most options of a native list that are reported. */
export const FOCUS_OPTIONS_MAX = 80;
/** The most options of a list the page draws itself that are reported: a list of countries is about 250. */
export const LIST_OPTIONS_MAX = 400;
/** The longest value, label, or message that is reported. */
export const FOCUS_TEXT_MAX_CHARS = 200;

/** The most characters of a page's text that are sent, so a long page stays one request. */
export const PAGE_TEXT_MAX_CHARS = 24_000;

/** What one frame says of its text. */
export interface FrameText {
  url: string;
  text: string;
  /** Custom elements with no open shadow root: their content may sit in a closed one. */
  custom: number;
}

/**
 * Runs in a page, or in each frame of it, and collects the visible text. It is a function, not a
 * string, because the browser runs it in every frame (`chrome.scripting`), so it names nothing
 * outside itself. It goes into open shadow roots and same-origin frames; a frame of another
 * origin is read by the browser running this function inside it. It reports the custom
 * elements it could not look into, which is the sign of a closed shadow root.
 */
export function collectPageText(limit: number): FrameText {
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);
  const block = new Set([
    "P",
    "DIV",
    "LI",
    "UL",
    "OL",
    "BR",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "TR",
    "SECTION",
    "ARTICLE",
    "HEADER",
    "FOOTER",
    "TABLE",
    "DT",
    "DD",
    "BLOCKQUOTE",
    "PRE",
    "FORM",
    "FIELDSET",
  ]);
  const pieces: string[] = [];
  let size = 0;
  let custom = 0;
  const walk = (node: Node, depth: number): void => {
    if (size >= limit || depth > 250) return;
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      if (text) {
        pieces.push(text);
        size += text.length + 1;
      }
      return;
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      if (skip.has(element.tagName)) return;
      // Text the page does not show (a message kept for after an upload, a closed menu) is not on
      // the page: a model that reads it believes what the screen contradicts.
      try {
        const view = element.ownerDocument.defaultView ?? window;
        const style = view.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return;
      } catch {
        // An element that cannot be styled (another document): its text is read as it is.
      }
      if (element.tagName.includes("-") && !element.shadowRoot) custom += 1;
      if (block.has(element.tagName)) pieces.push("\n");
      if (element.tagName === "IFRAME") {
        try {
          const inside = (element as HTMLIFrameElement).contentDocument;
          if (inside?.documentElement) walk(inside.documentElement, depth + 1);
        } catch {
          // A frame of another origin: the browser reads it by running this in it.
        }
        return;
      }
      if (element.shadowRoot) walk(element.shadowRoot, depth + 1);
    } else if (node.nodeType !== 11 && node.nodeType !== 9) {
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child, depth + 1);
  };
  walk(document.documentElement, 0);
  const text = pieces
    .join(" ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
  return { url: location.href, text, custom };
}

type FlatNode = {
  nodeId: number;
  parentId?: number;
  nodeType: number;
  nodeName: string;
  nodeValue?: string;
  shadowRootType?: string;
};
const FLAT_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);

/**
 * The text the debugger's DOM view can reach that a script cannot: inside closed shadow roots and
 * the documents of frames the script could not enter. Only that is returned, and only what the
 * other reads did not already give: the rest of this view holds text the page does not show (the
 * debugger's tree has no styles to tell), which the script read has left out.
 */
async function deeperText(cdp: Cdp, have: string): Promise<string> {
  try {
    const flat = await cdp.send<{ nodes?: FlatNode[] }>("DOM.getFlattenedDocument", {
      depth: -1,
      pierce: true,
    });
    const nodes = new Map<number, FlatNode>();
    for (const node of flat.nodes ?? []) nodes.set(node.nodeId, node);
    const extra: string[] = [];
    let size = 0;
    for (const node of nodes.values()) {
      if (node.nodeType !== 3 || size >= PAGE_TEXT_MAX_CHARS) continue;
      const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 3 || have.includes(text)) continue;
      let hidden = false;
      let beyondScript = false;
      let parentId = node.parentId;
      for (let depth = 0; parentId != null && depth < 40; depth += 1) {
        const up = nodes.get(parentId);
        if (!up) {
          // A parent this view does not list is a shadow root: Chrome 154 lists the nodes inside a
          // closed root but not the root itself, so the chain ends here, beyond what a script reads.
          beyondScript = true;
          break;
        }
        if (FLAT_SKIP.has(up.nodeName)) {
          hidden = true;
          break;
        }
        if (up.shadowRootType === "closed" || (up.nodeType === 9 && up.parentId != null)) {
          beyondScript = true;
        }
        parentId = up.parentId;
      }
      if (hidden || !beyondScript) continue;
      extra.push(text);
      size += text.length + 1;
    }
    return extra.join("\n");
  } catch {
    return "";
  }
}

async function frameCount(cdp: Cdp): Promise<number> {
  try {
    type Tree = { frame?: unknown; childFrames?: Tree[] };
    const answer = await cdp.send<{ frameTree?: Tree }>("Page.getFrameTree");
    const count = (tree?: Tree): number =>
      tree ? 1 + (tree.childFrames ?? []).reduce((sum, child) => sum + count(child), 0) : 0;
    return count(answer.frameTree);
  } catch {
    return 0;
  }
}

/** The host of an address, for labelling a frame's text. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * The page's visible text from every frame of the tab, in the open and closed shadow roots, "" when there
 * is none or it cannot be read. A job description may sit in an embedded frame of another origin or in a
 * component's shadow root, where `innerText` of the page does not reach. The browser runs
 * `collectPageText` in each frame; the debugger's DOM view adds closed shadow roots, and frames
 * the browser would not let a script into, but only when something points to them.
 */
export async function readPageText(cdp: Cdp, tabId?: number): Promise<string> {
  const frames: FrameText[] = [];
  let scripted = 0;
  if (tabId != null && typeof chrome !== "undefined" && chrome.scripting?.executeScript) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: collectPageText,
        args: [PAGE_TEXT_MAX_CHARS],
      });
      scripted = results.length;
      // The top frame first, then the others in the order the browser gave them.
      const ordered = [...results].sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0));
      for (const result of ordered) if (result.result?.text) frames.push(result.result);
    } catch {
      // A page the extension cannot script (an internal page): the debugger reads the top frame.
    }
  }
  if (frames.length === 0) {
    try {
      const answer = await cdp.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
        expression: `(${collectPageText.toString()})(${PAGE_TEXT_MAX_CHARS})`,
        returnByValue: true,
      });
      const value = answer.result?.value as FrameText | undefined;
      if (value?.text) frames.push(value);
    } catch {
      // nothing to read
    }
  }
  let combined = "";
  frames.forEach((frame, index) => {
    // A same-origin frame is already inside its parent's text; the same text is not added twice.
    if (index > 0 && combined.includes(frame.text.slice(0, 160))) return;
    combined += (index > 0 ? `\n\n[Frame from ${hostOf(frame.url)}]\n` : "") + frame.text;
  });
  const custom = frames.reduce((sum, frame) => sum + frame.custom, 0);
  if (custom > 0 || (scripted > 0 && (await frameCount(cdp)) > scripted)) {
    const deeper = await deeperText(cdp, combined);
    if (deeper) combined += `\n\n[Deeper in the page]\n${deeper}`;
  }
  return combined.trim().slice(0, PAGE_TEXT_MAX_CHARS);
}

/**
 * The page-side function. It runs in the page, so it is a string: it reads the focused
 * control, looking through shadow roots and same-origin frames, and hides what a password
 * field holds.
 */
export const FOCUS_SCRIPT = `(() => {
  const MAX = ${FOCUS_TEXT_MAX_CHARS};
  const OPTIONS_MAX = ${FOCUS_OPTIONS_MAX};
  const clip = (text) => String(text ?? "").replace(/\\s+/g, " ").trim().slice(0, MAX);
  let el = document.activeElement;
  for (let depth = 0; el && depth < 8; depth += 1) {
    if (el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    else if (el.tagName === "IFRAME") {
      try {
        const inner = el.contentDocument && el.contentDocument.activeElement;
        if (!inner || inner === el.contentDocument.body) break;
        el = inner;
      } catch (error) {
        break;
      }
    } else break;
  }
  if (!el || el === document.body || el === document.documentElement) return null;
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type") || "";
  const labelledBy = (el.getAttribute("aria-labelledby") || "")
    .split(/\\s+/)
    .map((id) => (el.ownerDocument.getElementById(id) || {}).textContent)
    .filter(Boolean)
    .join(" ");
  const label = clip(
    el.getAttribute("aria-label") ||
      labelledBy ||
      (el.labels && el.labels[0] && el.labels[0].textContent) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      ""
  );
  const out = { tag, label };
  if (type) out.type = type;
  if (tag === "select") {
    out.options = Array.from(el.options).slice(0, OPTIONS_MAX).map((o) => clip(o.text));
    out.multiple = el.multiple;
    out.value = Array.from(el.selectedOptions).map((o) => clip(o.text)).join(", ");
  } else if (tag === "input" || tag === "textarea") {
    const value = el.value || "";
    out.value = type === "password" ? (value ? "(" + value.length + " characters, hidden)" : "") : clip(value);
    if (type === "checkbox" || type === "radio") out.checked = el.checked;
  } else if (el.isContentEditable) {
    out.value = clip(el.textContent);
  } else if (el.getAttribute("role") === "combobox") {
    out.value = clip(el.value || el.textContent);
  }
  if (el.required || el.getAttribute("aria-required") === "true") out.required = true;
  if (el.validity && !el.validity.valid) out.invalid = clip(el.validationMessage);
  else if (el.getAttribute("aria-invalid") === "true") {
    const messageId = el.getAttribute("aria-errormessage");
    const message = messageId && el.ownerDocument.getElementById(messageId);
    out.invalid = clip(message ? message.textContent : "marked invalid");
  }
  return out;
})()`;

type EvaluateResult = { result?: { value?: AgentFocus | null }; exceptionDetails?: unknown };

/** The focused control, or null when nothing has focus or the page would not say. */
export async function readFocus(cdp: Cdp): Promise<AgentFocus | null> {
  try {
    const answer = await cdp.send<EvaluateResult>("Runtime.evaluate", {
      expression: FOCUS_SCRIPT,
      returnByValue: true,
    });
    if (answer.exceptionDetails) return null;
    return answer.result?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The page-side function that reads a list of choices open on the page, as the page names its options
 * (the ARIA roles a list the page draws itself carries: a listbox, menu or tree, and their options). It is
 * the list the focused control opens (`aria-controls` or `aria-owns` on it or on the combobox round it),
 * else the one drawn list, else the drawn list nearest below the focused control. Options are those that
 * are drawn and not disabled, in the order they are drawn, so the n-th is reached with Home and n-1
 * ArrowDown. A list that is drawn with nothing in it is reported empty (a box that searches as one types);
 * no list at all is null.
 */
export const OPEN_LIST_SCRIPT = `(() => {
  const MAX = ${LIST_OPTIONS_MAX};
  const TEXT = ${FOCUS_TEXT_MAX_CHARS};
  const clip = (text) => String(text ?? "").replace(/\\s+/g, " ").trim().slice(0, TEXT);
  const drawn = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  };
  let focused = document.activeElement;
  for (let depth = 0; focused && depth < 8; depth += 1) {
    if (focused.shadowRoot && focused.shadowRoot.activeElement) focused = focused.shadowRoot.activeElement;
    else break;
  }
  if (focused === document.body || focused === document.documentElement) focused = null;
  const listOf = (el) => {
    const ids = ((el.getAttribute("aria-controls") || "") + " " + (el.getAttribute("aria-owns") || "")).split(/\\s+/).filter(Boolean);
    for (const id of ids) {
      const list = document.getElementById(id);
      if (list && drawn(list)) return list;
    }
    return null;
  };
  let list = null;
  for (let el = focused; el && !list; el = el.parentElement) {
    if (el === document.body) break;
    if (el === focused || el.getAttribute("role") === "combobox") list = listOf(el);
  }
  if (!list) {
    const lists = Array.from(document.querySelectorAll("[role=listbox], [role=menu], [role=tree]")).filter(drawn);
    if (lists.length === 1) list = lists[0];
    else if (lists.length > 1 && focused) {
      const bottom = focused.getBoundingClientRect().bottom;
      lists.sort((a, b) => Math.abs(a.getBoundingClientRect().top - bottom) - Math.abs(b.getBoundingClientRect().top - bottom));
      list = lists[0];
    }
  }
  const OPTION = "[role=option], [role=menuitem], [role=menuitemradio], [role=treeitem]";
  const items = Array.from(list ? list.querySelectorAll(OPTION) : document.querySelectorAll("[role=option]"))
    .filter((el) => drawn(el) && el.getAttribute("aria-disabled") !== "true")
    .slice(0, MAX);
  if (!list && items.length === 0) return null;
  // Where each option is drawn, in CSS pixels from the page's top left: the agent clicks the one it picks.
  const boxOf = (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height };
  };
  return { options: items.map((el) => clip(el.textContent)), boxes: items.map(boxOf) };
})()`;

type ListResult = { result?: { value?: AgentOpenList | null }; exceptionDetails?: unknown };

/** Whether a value is a box with finite sides. */
function isRect(value: unknown): value is AgentRect {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  return ["x", "y", "w", "h"].every(
    (key) => typeof box[key] === "number" && Number.isFinite(box[key]),
  );
}

/**
 * The list of choices open on the page, as the page names its options and where it draws each, or null
 * when it names none. `scale` is screenshot pixels per CSS pixel, so the boxes come out in the
 * screenshot's pixels like the page's control marks.
 */
export async function readOpenList(cdp: Cdp, scale = 1): Promise<AgentOpenList | null> {
  try {
    const answer = await cdp.send<ListResult>("Runtime.evaluate", {
      expression: OPEN_LIST_SCRIPT,
      returnByValue: true,
    });
    if (answer.exceptionDetails) return null;
    const list = answer.result?.value;
    if (!list || !Array.isArray(list.options)) return null;
    const options = list.options.filter((option) => typeof option === "string");
    const boxes = Array.isArray(list.boxes) ? list.boxes : [];
    if (boxes.length !== options.length || !boxes.every(isRect)) return { options };
    return {
      options,
      boxes: boxes.map((box) => ({
        x: box.x * scale,
        y: box.y * scale,
        w: box.w * scale,
        h: box.h * scale,
      })),
    };
  } catch {
    return null;
  }
}
