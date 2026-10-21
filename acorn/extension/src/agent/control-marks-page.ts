/**
 * The scripts the run puts in the page to follow its controls (`control-marks.ts` says what for). The
 * page keeps the list of its visible controls current with a MutationObserver and a ResizeObserver, and
 * answers a few questions about it: where a control is now, whether a point is on a control's field, and
 * how long the page has been quiet. They are strings because the debugger runs them in the page.
 *
 * What is a control: an input, a text area, a select, a button, a link, or anything the page gives the
 * role of a button, a check, a radio or a combobox, that is drawn and not fixed to the window. A fixed or
 * sticky control (a cookie banner's button, a header's link) has a different place on the page at every
 * scroll position, so it says nothing of where the form is and is left out.
 */

import {
  ENTRY_MIN_HEIGHT_PX,
  FIELD_MAX_HEIGHT_PX,
  MARK_LABEL_MAX_CHARS,
  MAX_CONTROL_MARKS,
  SIZELESS_ANCESTORS,
} from "./control-marks";

/** The property the page keeps the latest list on. */
export const CONTROL_MARKS_KEY = "__acornControlMarks";
/** Names the script a page holds: a page that has an older build has it taken off and this one put on. */
const CONTROL_MARKS_BUILD = import.meta.env?.VITE_ACORN_VERSION ?? "dev";
/** How long after a change the page collects its list again: a burst of changes is one collection. */
const COLLECT_DELAY_MS = 60;
/** What the page's controls are. */
const CONTROL_SELECTOR =
  "input, textarea, select, button, a[href], [role=button], [role=checkbox], [role=radio], [role=combobox], [contenteditable=true]";

/**
 * Installs the observers once per document and returns the list's version. MutationObserver sees nodes
 * appear (a code block) and change; ResizeObserver sees a field pushed down without a new node (a warning
 * under it). Both schedule one collection a moment later; `flush` collects at once.
 */
function installBody(): string {
  return `(() => {
    const key = ${JSON.stringify(CONTROL_MARKS_KEY)};
    const build = ${JSON.stringify(CONTROL_MARKS_BUILD)};
    const found = window[key];
    if (found && found.installed && found.build === build) return found.version;
    if (found && typeof found.stop === "function") found.stop();
    const SELECTOR = ${JSON.stringify(CONTROL_SELECTOR)};
    const MAX = ${MAX_CONTROL_MARKS};
    const FIELD_MAX_H = ${FIELD_MAX_HEIGHT_PX};
    const ENTRY_MIN_H = ${ENTRY_MIN_HEIGHT_PX};
    const LABEL_MAX = ${MARK_LABEL_MAX_CHARS};
    const SIZELESS_UP = ${SIZELESS_ANCESTORS};
    const state = {
      installed: true, build, version: Math.floor(Math.random() * 1e9), marks: [], els: new Map(), idOf: new WeakMap(),
      lastActivity: performance.now(), stop: null,
    };
    const round = (value) => Math.round(value * 10) / 10;
    const boxOf = (rect) => ({
      x: round(rect.left + window.scrollX), y: round(rect.top + window.scrollY),
      w: round(rect.width), h: round(rect.height),
    });
    const collapse = (text, max) => String(text || "").replace(/\\s+/g, " ").trim().slice(0, max);
    const sized = (rect) => rect.width >= 1 && rect.height >= 1;
    // The box a control is drawn in. A text box or dropdown input drawn without a size (a dropdown the page
    // draws itself sizes its input by what is typed into it: nothing, so nothing) has the box of the first
    // ancestor that has one, the row it sits on, as long as that is a row and not a section of the page.
    const rectOf = (el, tag) => {
      const own = el.getBoundingClientRect();
      if (sized(own) || (tag !== "input" && tag !== "textarea")) return own;
      for (let node = el.parentElement, up = 0; node && node !== document.body && up < SIZELESS_UP; node = node.parentElement, up += 1) {
        const rect = node.getBoundingClientRect();
        if (sized(rect)) return rect.height <= FIELD_MAX_H ? rect : own;
      }
      return own;
    };
    // The element that labels a control, when the page says which one does.
    const labelElOf = (el) => {
      if (el.labels && el.labels.length > 0) return el.labels[0];
      const by = el.getAttribute("aria-labelledby");
      if (by) return document.getElementById(by.split(" ")[0]);
      return null;
    };
    const labelOf = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return collapse(aria, LABEL_MAX);
      const labelEl = labelElOf(el);
      if (labelEl) return collapse(labelEl.textContent, LABEL_MAX);
      const own = el.getAttribute("placeholder") || el.getAttribute("title");
      if (own) return collapse(own, LABEL_MAX);
      const role = el.getAttribute("role");
      if (el.tagName === "BUTTON" || el.tagName === "A" || role === "button") return collapse(el.textContent, LABEL_MAX);
      return "";
    };
    // The part of a control's box that is not its label, when the label lies inside the box (a question
    // printed inside a bordered field): the line a value is typed or shown on. Null when the label is
    // elsewhere or what is left is too small to be a line.
    const entryOf = (el, rect) => {
      const labelEl = labelElOf(el);
      if (!labelEl || !labelEl.getBoundingClientRect) return null;
      const lab = labelEl.getBoundingClientRect();
      if (lab.width < 1 || lab.height < 1) return null;
      const inside = lab.left >= rect.left - 1 && lab.right <= rect.right + 1 && lab.top >= rect.top - 1 && lab.bottom <= rect.bottom + 1;
      if (!inside) return null;
      const below = rect.bottom - lab.bottom, above = lab.top - rect.top;
      if (below >= above && below >= ENTRY_MIN_H) return boxOf({ left: rect.left, top: lab.bottom, width: rect.width, height: below });
      if (above >= ENTRY_MIN_H) return boxOf({ left: rect.left, top: rect.top, width: rect.width, height: above });
      return null;
    };
    // Whether a control is empty, when the page can tell: a text box, a text area, a native list, an
    // editable area. A dropdown the page draws itself keeps its value elsewhere, and a check or a button has none.
    const emptyOf = (el, tag, type) => {
      if (el.getAttribute("role") === "combobox") return undefined;
      if (tag === "textarea" || tag === "select") return el.value === "";
      if (tag === "input") {
        if (type === "checkbox" || type === "radio" || type === "file" || type === "button" || type === "submit" || type === "reset" || type === "image" || type === "hidden") return undefined;
        return el.value === "";
      }
      if (el.isContentEditable) return collapse(el.textContent, 1) === "";
      return undefined;
    };
    const kindOf = (el, tag, type) => {
      const role = el.getAttribute("role");
      if (type === "file") return "file";
      if (type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio") return "check";
      if (tag === "select" || role === "combobox") return "select";
      if (tag === "input" && (type === "button" || type === "submit" || type === "reset" || type === "image")) return "button";
      if (tag === "input" || tag === "textarea" || el.isContentEditable) return "input";
      if (tag === "a") return "link";
      return "button";
    };
    let scheduled = false;
    let fixedMemo = new Map();
    const isFixed = (node) => {
      const trail = [];
      let answer = false;
      for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
        if (fixedMemo.has(current)) { answer = fixedMemo.get(current); break; }
        trail.push(current);
        const position = getComputedStyle(current).position;
        if (position === "fixed" || position === "sticky") { answer = true; break; }
      }
      for (const seen of trail) fixedMemo.set(seen, answer);
      return answer;
    };
    const fieldOf = (el, own, under) => {
      let best = null;
      for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        if (under.get(node) !== 1) break;
        const rect = node.getBoundingClientRect();
        if (rect.height > FIELD_MAX_H) break;
        best = rect;
      }
      if (!best || best.width < 1 || best.height < 1) return null;
      const left = Math.min(best.left, own.left), top = Math.min(best.top, own.top);
      const right = Math.max(best.right, own.right), bottom = Math.max(best.bottom, own.bottom);
      return boxOf({ left, top, width: right - left, height: bottom - top });
    };
    const collect = () => {
      scheduled = false;
      fixedMemo = new Map();
      const entries = [];
      const signatures = new Map();
      for (const el of document.querySelectorAll(SELECTOR)) {
        if (entries.length >= MAX) break;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const type = (el.getAttribute("type") || "").toLowerCase();
        const tag = el.tagName.toLowerCase();
        const rect = rectOf(el, tag);
        if (!sized(rect)) continue;
        if (isFixed(el)) continue;
        const signature = tag + ":" + type + ":" + (el.getAttribute("name") || el.id || "") + ":" + labelOf(el);
        signatures.set(signature, (signatures.get(signature) || 0) + 1);
        entries.push({ el, signature, type, tag, rect });
      }
      const under = new Map();
      for (const entry of entries) {
        for (let node = entry.el.parentElement; node; node = node.parentElement) under.set(node, (under.get(node) || 0) + 1);
      }
      const seen = new Map();
      const marks = [];
      const els = new Map();
      const idOf = new WeakMap();
      for (const entry of entries) {
        const total = signatures.get(entry.signature);
        const nth = (seen.get(entry.signature) || 0) + 1;
        seen.set(entry.signature, nth);
        const id = total === 1 ? entry.signature : entry.signature + "#" + nth + "/" + total;
        const mark = { id, kind: kindOf(entry.el, entry.tag, entry.type), ...boxOf(entry.rect) };
        const field = fieldOf(entry.el, entry.rect, under);
        if (field) mark.box = field;
        const label = labelOf(entry.el);
        if (label) mark.label = label;
        const place = entryOf(entry.el, entry.rect);
        if (place) mark.entry = place;
        if (entry.el.required === true || entry.el.getAttribute("aria-required") === "true") mark.required = true;
        const empty = emptyOf(entry.el, entry.tag, entry.type);
        if (typeof empty === "boolean") mark.empty = empty;
        if (entry.el.getAttribute("aria-invalid") === "true") mark.invalid = true;
        marks.push(mark);
        els.set(id, new WeakRef(entry.el));
        idOf.set(entry.el, id);
      }
      state.marks = marks;
      state.els = els;
      state.idOf = idOf;
      state.version += 1;
    };
    const schedule = () => {
      state.lastActivity = performance.now();
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => requestAnimationFrame(collect), ${COLLECT_DELAY_MS});
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    const sizes = window.ResizeObserver ? new ResizeObserver(schedule) : null;
    if (sizes) sizes.observe(document.documentElement);
    state.stop = () => { mutations.disconnect(); if (sizes) sizes.disconnect(); };
    const live = (id) => {
      const ref = state.els.get(id);
      const el = ref ? ref.deref() : null;
      return el && el.isConnected ? el : null;
    };
    state.flush = () => { collect(); return state.version; };
    state.read = (since) => (since === state.version ? { version: state.version } : { version: state.version, marks: state.marks });
    state.where = (id) => {
      const el = live(id);
      if (!el) return null;
      const rect = rectOf(el, el.tagName.toLowerCase());
      return sized(rect) ? boxOf(rect) : null;
    };
    state.holds = (id, x, y) => {
      const el = live(id);
      const hit = el ? document.elementFromPoint(x, y) : null;
      if (!el || !hit) return false;
      let field = el;
      while (field && field !== document.body && field !== document.documentElement && !field.contains(hit)) field = field.parentElement;
      if (!field || field === document.body || field === document.documentElement) return false;
      if (field === el) return true;
      if (field.getBoundingClientRect().height > FIELD_MAX_H) return false;
      for (const other of field.querySelectorAll(SELECTOR)) {
        if (other !== el && state.idOf.has(other)) return false;
      }
      return true;
    };
    state.quiet = (minMs, quietMs, maxMs) => new Promise((resolve) => {
      if (document.visibilityState === "hidden") { resolve(-1); return; }
      const began = performance.now();
      const animating = () => typeof document.getAnimations === "function" && document.getAnimations().some((animation) => {
        if (animation.playState !== "running") return false;
        const target = animation.effect && animation.effect.target;
        const root = target && target.getRootNode ? target.getRootNode() : null;
        if (root && root !== document) return false;
        const timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : null;
        return !timing || Number.isFinite(timing.endTime);
      });
      const check = () => {
        const now = performance.now();
        const waited = now - began;
        if (waited >= maxMs || (waited >= minMs && now - state.lastActivity >= quietMs && !animating())) { resolve(waited); return; }
        setTimeout(check, 16);
      };
      check();
    });
    window[key] = state;
    collect();
    return state.version;
  })()`;
}

/** Installs the observers; harmless when they are already there. */
export function controlMarkInstallScript(): string {
  return installBody();
}

/** What a call answers when the page has not got the script (a new document): the caller installs it and asks again. */
export const CONTROL_MARKS_MISSING = { missing: true } as const;

/**
 * Runs `body` (statements that use `state`) in the page. A page that has not got the script, or has an
 * older build of it, answers `CONTROL_MARKS_MISSING` without running `body`: the call stays small, and the
 * installing is done once per document.
 */
function withState(body: string): string {
  return `(() => {
    const state = window[${JSON.stringify(CONTROL_MARKS_KEY)}];
    if (!state || !state.installed || state.build !== ${JSON.stringify(CONTROL_MARKS_BUILD)}) return ${JSON.stringify(CONTROL_MARKS_MISSING)};
    ${body}
  })()`;
}

/** Reads the list: `since` is the version the caller has (its marks are left out when nothing changed); `fresh` collects first. */
export function controlMarkReadScript(since: number, fresh: boolean): string {
  return withState(`${fresh ? "state.flush();" : ""} return state.read(${JSON.stringify(since)});`);
}

/** Where a control is now (a box on the page), or null when it is gone. The list is collected first. */
export function controlMarkWhereScript(id: string): string {
  return withState(`state.flush(); return state.where(${JSON.stringify(id)});`);
}

/** Whether the point (CSS pixels in the window) is on the control's field. */
export function controlMarkHoldsScript(id: string, x: number, y: number): string {
  return withState(`return state.holds(${JSON.stringify(id)}, ${Number(x)}, ${Number(y)});`);
}

/**
 * Waits until the page has been quiet (no change to the page, no animation of it running) for `quietMs`,
 * at least `minMs` and at most `maxMs` after it began. Resolves with how long it waited, or -1 when the
 * tab is hidden (a hidden tab's timers run slowly: the caller waits the whole time instead).
 */
export function controlMarkQuietScript(minMs: number, quietMs: number, maxMs: number): string {
  return withState(`return state.quiet(${Number(minMs)}, ${Number(quietMs)}, ${Number(maxMs)});`);
}
