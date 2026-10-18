/**
 * Reading a serialized frame for the plain fields still empty in it. A field is told apart from another
 * by what it declares about itself (its type, name, id, label and placeholder), not by where it is.
 */

import type { DomNode } from "./dom-types";

/** Input types the pass never fills: not a place text goes, or only the applicant's own hand fills it. */
const NEVER_FILLED = new Set([
  "hidden",
  "submit",
  "button",
  "image",
  "reset",
  "search",
  "range",
  "color",
]);

/** What the pass finds in a frame's tree. */
export interface TreeScan {
  /** One signature for each plain field that is still empty. */
  empty: string[];
  /** The frame holds a file input: the page may offer to fill itself from a résumé. */
  hasFile: boolean;
}

function signature(node: DomNode, type: string): string {
  const attrs = node.attrs ?? {};
  return [
    node.tag,
    type,
    attrs.name ?? "",
    node.id ?? "",
    attrs["aria-label"] ?? "",
    attrs.placeholder ?? "",
  ].join("|");
}

function hasSelectedOption(node: DomNode): boolean {
  return node.children.some(
    (child) => child.attrs?.selected !== undefined || hasSelectedOption(child),
  );
}

/** Walks a serialized frame for its empty plain fields. */
export function scanTree(root: DomNode): TreeScan {
  const scan: TreeScan = { empty: [], hasFile: false };
  const visit = (node: DomNode): void => {
    if (node.tag === "input") {
      const type = (node.attrs?.type ?? "text").toLowerCase();
      if (type === "file") scan.hasFile = true;
      else if (!NEVER_FILLED.has(type)) {
        const holds =
          type === "radio" || type === "checkbox" ? node.attrs?.checked : node.attrs?.value;
        if (!holds) scan.empty.push(signature(node, type));
      }
    } else if (node.tag === "textarea") {
      if (!node.attrs?.value) scan.empty.push(signature(node, "textarea"));
    } else if (node.tag === "select" && !hasSelectedOption(node)) {
      scan.empty.push(signature(node, "select"));
    }
    node.children.forEach(visit);
  };
  visit(root);
  return scan;
}
