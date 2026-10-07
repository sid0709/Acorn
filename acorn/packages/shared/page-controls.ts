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
}

function squash(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function textOf(node: DomTreeNode): string {
  const parts: string[] = [];
  const walk = (current: DomTreeNode) => {
    const own = squash(current.text);
    if (own) parts.push(own);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return squash(parts.join(" ")).slice(0, CONTROL_TEXT_MAX);
}

function isControl(node: DomTreeNode): boolean {
  const role = node.attrs?.role;
  if (node.tag === "button" || role === "button") return true;
  if (node.tag === "a") return Boolean(node.attrs?.href) || role === "link";
  if (node.tag === "input") return BUTTON_INPUT_TYPES.has((node.attrs?.type ?? "").toLowerCase());
  return false;
}

function isDisabled(node: DomTreeNode): boolean {
  return node.attrs?.disabled === "true" || node.attrs?.["aria-disabled"] === "true";
}

/** Controls in document order, with the form or chrome region around each. */
export function collectPageControls(root: DomTreeNode): PageControl[] {
  const out: PageControl[] = [];
  const walk = (node: DomTreeNode, form: string | null, chrome: string) => {
    let nextForm = form;
    let nextChrome = chrome;
    if (node.tag === "form") {
      nextForm = squash(node.attrs?.["aria-label"] ?? node.attrs?.name) || "form";
    }
    if (CHROME_TAGS.has(node.tag)) nextChrome = node.tag;

    if (isControl(node)) {
      const text = textOf(node);
      const label = squash(node.attrs?.["aria-label"] ?? node.attrs?.value);
      if (text || label) {
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
        });
      }
    }
    for (const child of node.children) walk(child, nextForm, nextChrome);
  };
  walk(root, null, "");
  return prioritize(out).slice(0, PAGE_CONTROLS_MAX);
}

/** In-form, enabled, non-chrome controls first, so a long page cannot push the real one out. */
function prioritize(controls: PageControl[]): PageControl[] {
  const rank = (c: PageControl) => (c.disabled ? 3 : 0) + (c.context ? 2 : 0) + (c.inForm ? 0 : 1);
  return controls
    .map((control, index) => ({ control, index }))
    .sort((a, b) => rank(a.control) - rank(b.control) || a.index - b.index)
    .map((row) => row.control);
}

const FIELD_TAGS = new Set(["input", "select", "textarea"]);
const NON_FIELD_INPUTS = new Set(["hidden", ...BUTTON_INPUT_TYPES]);

/** A short, stable hash for comparing two page states. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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
  return `${address}|${hash(fields.length ? fields.join("|") : text)}`;
}
