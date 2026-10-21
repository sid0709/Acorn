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

import { EXTENSION_BUILD } from "../build-version";

import {
  ENTRY_MIN_HEIGHT_PX,
  FIELD_MAX_HEIGHT_PX,
  MARK_LABEL_MAX_CHARS,
  MARK_VALUE_MAX_CHARS,
  MAX_CONTROL_MARKS,
  SIZELESS_ANCESTORS,
} from "./control-marks";

/** The property the page keeps the latest list on. */
export const CONTROL_MARKS_KEY = "__acornControlMarks";
/** Names the script a page holds: a page that has an older build has it taken off and this one put on. */
const CONTROL_MARKS_BUILD = EXTENSION_BUILD;
/** How long after a change the page collects its list again: a burst of changes is one collection. */
const COLLECT_DELAY_MS = 60;
/** What the page's controls are. */
const CONTROL_SELECTOR =
  "input, textarea, select, button, a[href], [role=button], [role=checkbox], [role=radio], [role=combobox], [contenteditable=true]";

/**
 * Installs the observers once per document and returns the list's version. MutationObserver sees nodes
 * appear (a code block) and change; ResizeObserver sees a field pushed down without a new node (a warning
 * under it). Both schedule one collection a moment later; `flush` collects at once. Typing changes a value
 * and nothing the observers see, so an `input` or `change` event collects the list again too (what the
 * sidebar shows keeps up) without counting as activity: the run's waits for a quiet page are as before.
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
    const VALUE_MAX = ${MARK_VALUE_MAX_CHARS};
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
    // What a control shows now, for the person to read in the sidebar: a typed answer, the option a native
    // list shows, a chosen file's name. A password or a card number is never read; a dropdown the page draws
    // itself is not either (its text may be its own prompt), and a check says it with \`checked\`.
    const VALUELESS_TYPES = new Set(["password", "hidden", "checkbox", "radio", "button", "submit", "reset", "image"]);
    const valueOf = (el, tag, type) => {
      if (/(^|\\s)cc-/.test((el.getAttribute("autocomplete") || "").toLowerCase())) return "";
      if (tag === "textarea") return collapse(el.value, VALUE_MAX);
      if (tag === "select") {
        if (el.value === "") return "";
        const chosen = Array.from(el.selectedOptions || [], (option) => collapse(option.textContent, VALUE_MAX));
        return collapse(chosen.filter(Boolean).join(", "), VALUE_MAX);
      }
      if (tag === "input") {
        if (VALUELESS_TYPES.has(type)) return "";
        if (type === "file") return collapse(Array.from(el.files || [], (file) => file.name).join(", "), VALUE_MAX);
        return collapse(el.value, VALUE_MAX);
      }
      if (el.isContentEditable) return collapse(el.textContent, VALUE_MAX);
      return "";
    };
    const checkedOf = (el, tag, type) => {
      if (tag === "input" && (type === "checkbox" || type === "radio")) return el.checked === true;
      const role = el.getAttribute("role");
      if (role === "checkbox" || role === "radio") return el.getAttribute("aria-checked") === "true";
      return undefined;
    };
    // What the page calls a box of controls: its aria-label, or the element its aria-labelledby names.
    const ariaNameOf = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return collapse(aria, LABEL_MAX);
      const by = el.getAttribute("aria-labelledby");
      const named = by ? document.getElementById(by.split(" ")[0]) : null;
      return named ? collapse(named.textContent, LABEL_MAX) : "";
    };
    // The question a group of radio buttons or check boxes answers: its fieldset's legend, or the name of
    // the group the page drew round them.
    const questionOf = (el) => {
      const set = el.closest("fieldset");
      const legend = set ? set.querySelector("legend") : null;
      if (legend) return collapse(legend.textContent, LABEL_MAX);
      const box = el.closest("[role=radiogroup], [role=group]");
      return box ? ariaNameOf(box) : "";
    };
    // Radio buttons answer one question together, and so do check boxes that share a name: the key the
    // sidebar joins them by, with what the page calls the question. \`names\` counts the check boxes of each
    // name; \`boxes\` numbers the radio groups the page drew itself, in the page's order.
    const groupOf = (el, tag, type, names, boxes) => {
      const name = el.getAttribute("name");
      let key = "";
      if (tag === "input" && type === "radio" && name) key = "radio:" + name;
      else if (tag === "input" && type === "checkbox" && name && (names.get(name) || 0) > 1) key = "checkbox:" + name;
      else if (el.getAttribute("role") === "radio") {
        const box = el.closest("[role=radiogroup]");
        if (!box) return null;
        if (!boxes.has(box)) boxes.set(box, "radiogroup:" + (box.id || String(boxes.size + 1)));
        key = boxes.get(box);
      } else return null;
      return { key, question: questionOf(el) };
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
      const names = new Map();
      for (const entry of entries) {
        for (let node = entry.el.parentElement; node; node = node.parentElement) under.set(node, (under.get(node) || 0) + 1);
        const name = entry.tag === "input" && entry.type === "checkbox" ? entry.el.getAttribute("name") : null;
        if (name) names.set(name, (names.get(name) || 0) + 1);
      }
      const boxes = new Map();
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
        const value = valueOf(entry.el, entry.tag, entry.type);
        if (value) mark.value = value;
        const checked = checkedOf(entry.el, entry.tag, entry.type);
        if (typeof checked === "boolean") mark.checked = checked;
        const group = groupOf(entry.el, entry.tag, entry.type, names, boxes);
        if (group) {
          mark.group = group.key;
          if (group.question) mark.question = group.question;
        }
        marks.push(mark);
        els.set(id, new WeakRef(entry.el));
        idOf.set(entry.el, id);
      }
      state.marks = marks;
      state.els = els;
      state.idOf = idOf;
      state.version += 1;
    };
    const queue = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => requestAnimationFrame(collect), ${COLLECT_DELAY_MS});
    };
    const schedule = () => {
      state.lastActivity = performance.now();
      queue();
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    const sizes = window.ResizeObserver ? new ResizeObserver(schedule) : null;
    if (sizes) sizes.observe(document.documentElement);
    document.addEventListener("input", queue, true);
    document.addEventListener("change", queue, true);
    state.stop = () => {
      mutations.disconnect();
      if (sizes) sizes.disconnect();
      document.removeEventListener("input", queue, true);
      document.removeEventListener("change", queue, true);
    };
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
