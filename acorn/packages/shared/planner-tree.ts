/**
 * The compact Pure Tree the fill planner reads. The planner pays per input token
 * and answers slower the longer its prompt, so this keeps what it plans with —
 * every control, its attributes, and the question text around it — and drops
 * what it does not: layout-only wrappers, class tokens on non-controls, the
 * middle of long option lists (the runtime matches options live), and deep
 * indentation. Node ids are unchanged, so plan element indexes still resolve.
 */

import type { DomTreeNode } from "./tree-export";

/** Option lists longer than this show their head, a count, and their tail. */
const OPTION_LIST_MAX = 12;
const OPTION_HEAD = 6;
const OPTION_TAIL = 3;

/** Tags a person interacts with or that name a control; their attributes all stay. */
const CONTROL_TAGS = new Set([
  "a",
  "button",
  "fieldset",
  "form",
  "input",
  "label",
  "legend",
  "option",
  "select",
  "textarea",
]);

/** Attributes worth reading on any node, in output order. */
const ATTR_KEYS = [
  "for",
  "type",
  "role",
  "name",
  "aria-label",
  "aria-required",
  "aria-invalid",
  "aria-checked",
  "aria-expanded",
  "autocomplete",
  "placeholder",
  "value",
  "data-automation-id",
  "data-fkit-id",
  "selected",
  "checked",
] as const;

function isControl(node: DomTreeNode): boolean {
  return CONTROL_TAGS.has(node.tag) || Boolean(node.attrs?.role);
}

function isOptionLike(node: DomTreeNode): boolean {
  return node.tag === "option" || node.attrs?.role === "option";
}

function quote(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function detail(node: DomTreeNode): string {
  const parts: string[] = [];
  const control = isControl(node);
  // A domId only matters where a label's `for` or a planner rule can point at it.
  if (node.id && control) parts.push(`domId=${node.id}`);
  for (const key of ATTR_KEYS) {
    const value = node.attrs?.[key];
    if (value) parts.push(`${key}=${quote(value)}`);
  }
  // Class tokens name the host's widget; they only disambiguate controls.
  if (control && node.classes?.length) parts.push(`class=${quote(node.classes.join(" "))}`);
  return parts.join(" ");
}

/** A wrapper with nothing to say: no text, no attributes worth reading, not a control. */
function isBareWrapper(node: DomTreeNode): boolean {
  return !node.text && !isControl(node) && !detail(node);
}

function line(node: DomTreeNode, depth: number): string {
  const info = detail(node);
  const text = node.text ? ` "${node.text}"` : "";
  return `${" ".repeat(depth)}${node.tag}[${node.nodeId}]${info ? ` ${info}` : ""}${text}`;
}

function visibleChildren(node: DomTreeNode): (DomTreeNode | string)[] {
  const options = node.children.filter(isOptionLike);
  if (options.length <= OPTION_LIST_MAX) return node.children;
  const hidden = options.slice(OPTION_HEAD, options.length - OPTION_TAIL);
  const hiddenSet = new Set(hidden);
  const out: (DomTreeNode | string)[] = [];
  let summarized = false;
  for (const child of node.children) {
    if (!hiddenSet.has(child)) out.push(child);
    else if (!summarized) {
      out.push(`… ${hidden.length} more options …`);
      summarized = true;
    }
  }
  return out;
}

function* lines(node: DomTreeNode, depth: number): Generator<string> {
  const bare = isBareWrapper(node);
  if (!bare) yield line(node, depth);
  const childDepth = bare ? depth : depth + 1;
  for (const child of visibleChildren(node)) {
    if (typeof child === "string") yield `${" ".repeat(childDepth)}${child}`;
    else yield* lines(child, childDepth);
  }
}

/** The planner's compact tree text (one space of indent per level). */
export function formatPlannerTree(root: DomTreeNode): string {
  return Array.from(lines(root, 0)).join("\n");
}
