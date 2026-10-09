/**
 * The clickable controls on a page, read from the same tree the planner reads.
 * The Run orchestrator hands these to the decision model, which picks the one that
 * moves the application forward. Nothing here matches button wording: a site may
 * call the control Next, Continue, an arrow, or nothing at all.
 */

import type { DomTreeNode } from "./tree-export";

/** Most controls one decision lists. */
export const PAGE_CONTROLS_MAX = 120;
/** Longest text kept per control. */
const CONTROL_TEXT_MAX = 100;
/** Longest surrounding text kept for a control with no text of its own. */
const CONTROL_NEAR_MAX = 100;
/** How many enclosing nodes are searched for that surrounding text. */
const CONTROL_NEAR_DEPTH = 4;

/**
 * Tree attributes the serializer sets on a control from the page's layers: the
 * open dialog it sits in, and whether an open dialog covers it.
 */
export const LAYER_ATTR = {
  dialog: "acorn-dialog",
  covered: "acorn-covered",
  /** Not rendered (display:none or visibility:hidden): a person cannot click it at all. */
  hidden: "acorn-hidden",
} as const;

/** Regions whose controls are site chrome, not part of the application. */
const CHROME_TAGS = new Set(["nav", "header", "footer", "aside"]);

const BUTTON_INPUT_TYPES = new Set(["submit", "button", "image", "reset"]);

export interface PageControl {
  /** Tree node id: the extension clicks this node. */
  id: number;
  tag: string;
  text: string;
  /** aria-label or value when the control has no text of its own. */
  label: string;
  type: string;
  href: string;
  /** The enclosing form's name, or the chrome region (nav, header, footer) it sits in. */
  context: string;
  disabled: boolean;
  inForm: boolean;
  /** The open dialog the control sits in (its name, or "dialog"); "" outside every dialog. */
  dialog: string;
  /** An open dialog covers the control: a person could not click it right now. */
  covered: boolean;
  /**
   * For a control with no text of its own (an icon button): the text around it,
   * which names the entry or section it acts on. "" otherwise.
   */
  near: string;
}

function squash(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The text under node, stopping once max characters are read; skip is left out. */
function textOf(node: DomTreeNode, max = CONTROL_TEXT_MAX, skip?: DomTreeNode): string {
  const parts: string[] = [];
  let length = 0;
  const walk = (current: DomTreeNode) => {
    if (current === skip || length >= max) return;
    const own = squash(current.text);
    if (own) {
      parts.push(own);
      length += own.length + 1;
    }
    for (const child of current.children) walk(child);
  };
  walk(node);
  return squash(parts.join(" ")).slice(0, max);
}

/** The nearest enclosing text around a control, read outward a few levels. */
function nearText(control: DomTreeNode, ancestors: DomTreeNode[]): string {
  let inner = control;
  for (const ancestor of ancestors.slice(-CONTROL_NEAR_DEPTH).reverse()) {
    const text = textOf(ancestor, CONTROL_NEAR_MAX, inner);
    if (text) return text;
    inner = ancestor;
  }
  return "";
}

function isControl(node: DomTreeNode): boolean {
  const role = node.attrs?.role;
  if (node.tag === "button" || role === "button") return true;
  if (node.tag === "a") return Boolean(node.attrs?.href) || role === "link";
  if (node.tag === "input") return BUTTON_INPUT_TYPES.has((node.attrs?.type ?? "").toLowerCase());
  return false;
}

function isHidden(node: DomTreeNode): boolean {
  return node.attrs?.[LAYER_ATTR.hidden] === "true";
}

function isDisabled(node: DomTreeNode): boolean {
  return node.attrs?.disabled === "true" || node.attrs?.["aria-disabled"] === "true";
}

/**
 * Controls in document order, with the form or chrome region around each. A
 * control a person cannot see is left out, and so is one inside another control
 * (the native button a custom element wraps is that same control).
 */
export function collectPageControls(root: DomTreeNode): PageControl[] {
  const out: PageControl[] = [];
  const ancestors: DomTreeNode[] = [];
  const walk = (node: DomTreeNode, form: string | null, chrome: string) => {
    if (isHidden(node)) return;
    let nextForm = form;
    let nextChrome = chrome;
    if (node.tag === "form") {
      nextForm = squash(node.attrs?.["aria-label"] ?? node.attrs?.name) || "form";
    }
    if (CHROME_TAGS.has(node.tag)) nextChrome = node.tag;

    if (isControl(node)) {
      const text = textOf(node);
      const label = squash(node.attrs?.["aria-label"] ?? node.attrs?.value);
      const near = text ? "" : nearText(node, ancestors);
      if (text || label || near) {
        out.push({
          id: node.nodeId,
          tag: node.tag,
          text,
          label,
          type: (node.attrs?.type ?? "").toLowerCase(),
          href: node.attrs?.href ?? "",
          context: nextChrome || (nextForm && nextForm !== "form" ? nextForm : ""),
          disabled: isDisabled(node),
          inForm: nextForm != null,
          dialog: node.attrs?.[LAYER_ATTR.dialog] ?? "",
          covered: node.attrs?.[LAYER_ATTR.covered] === "true",
          near,
        });
      }
      return;
    }
    ancestors.push(node);
    for (const child of node.children) walk(child, nextForm, nextChrome);
    ancestors.pop();
  };
  walk(root, null, "");
  return prioritize(uncoverWhenNoneInDialog(out)).slice(0, PAGE_CONTROLS_MAX);
}

/**
 * A dialog covers controls only when it holds some of its own. When every control
 * reads as covered and none sits in a dialog, the dialog was not read right (its
 * buttons live where the page could not trace them): no control is covered then.
 */
function uncoverWhenNoneInDialog(controls: PageControl[]): PageControl[] {
  const misread =
    controls.length > 0 && controls.every((c) => c.covered) && !controls.some((c) => c.dialog);
  return misread ? controls.map((c) => ({ ...c, covered: false })) : controls;
}

/**
 * Controls in an open dialog first, then in-form, enabled, non-chrome, named ones;
 * controls a dialog covers last. A long page cannot push the real one out.
 */
function prioritize(controls: PageControl[]): PageControl[] {
  const rank = (c: PageControl) =>
    (c.dialog ? 0 : 1) +
    (c.text || c.label ? 0 : 1) +
    (c.covered ? 8 : 0) +
    (c.disabled ? 3 : 0) +
    (c.context ? 2 : 0) +
    (c.inForm ? 0 : 1);
  return controls
    .map((control, index) => ({ control, index }))
    .sort((a, b) => rank(a.control) - rank(b.control) || a.index - b.index)
    .map((row) => row.control);
}

const FIELD_TAGS = new Set(["input", "select", "textarea"]);
const NON_FIELD_INPUTS = new Set(["hidden", ...BUTTON_INPUT_TYPES]);

/** A short, stable hash for comparing two page states. */
export function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Fields a page asks for, by the same walk as pageSignature; 0 on a page with nothing to fill. */
export function countFormFields(root: DomTreeNode): number {
  let count = 0;
  const walk = (node: DomTreeNode) => {
    const type = (node.attrs?.type ?? "").toLowerCase();
    if (FIELD_TAGS.has(node.tag) && !NON_FIELD_INPUTS.has(type)) count += 1;
    for (const child of node.children) walk(child);
  };
  walk(root);
  return count;
}

/**
 * Which step of the application this is. Built from the fields the page asks for
 * (never their values, which Fill changes) and the address, so a validation error
 * on the same step keeps its signature and a new step, a posting, or the
 * confirmation page does not. A page with no fields falls back to its visible text.
 */
export function pageSignature(root: DomTreeNode, url: string, text: string): string {
  const fields: string[] = [];
  const walk = (node: DomTreeNode) => {
    const type = (node.attrs?.type ?? "").toLowerCase();
    if (FIELD_TAGS.has(node.tag) && !NON_FIELD_INPUTS.has(type)) {
      fields.push(
        [node.tag, type, node.attrs?.name, node.attrs?.["aria-label"], node.attrs?.placeholder]
          .map((part) => part ?? "")
          .join(":"),
      );
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  let address = url;
  try {
    const parsed = new URL(url);
    address = `${parsed.host}${parsed.pathname}`;
  } catch {
    // Keep the raw string for an address that does not parse.
  }
  return `${address}|${shortHash(fields.length ? fields.join("|") : text)}`;
}
