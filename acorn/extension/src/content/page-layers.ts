/**
 * Which controls sit inside an open dialog, and which an open dialog covers so a
 * person could not click them. Structural only: native <dialog>, ARIA dialog roles
 * and aria-modal (in open shadow roots too), inert subtrees, a backdrop that fills
 * the window, and what the browser reports on top at a control's centre. No class
 * names, ids, or wording.
 */

import { composedContains, composedParent, deepQueryAll } from "./shadow-control";

/** Elements that are a dialog while they are shown. */
const DIALOG_SELECTOR = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
/** Headings that name a dialog with no accessible name of its own. */
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
/** Longest dialog name kept. */
const DIALOG_NAME_MAX = 80;
/** A backdrop covers at least this share of the window's width and of its height. */
const BACKDROP_MIN_COVER = 0.9;
/** How far in from each corner the window is probed for a backdrop, as a share of its size. */
const BACKDROP_PROBE_INSET = 0.05;

export interface PageLayers {
  /** The name of the open dialog el sits in ("" when it has none), or null outside every dialog. */
  dialogOf(el: Element): string | null;
  /** An open dialog is over el: a click on it would land on the dialog or its backdrop. */
  covered(el: Element): boolean;
}

function isShown(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.visibility !== "hidden" && style?.display !== "none";
}

function isModal(el: Element): boolean {
  if (el.getAttribute("aria-modal") === "true") return true;
  try {
    return el.matches(":modal");
  } catch {
    return false;
  }
}

function squash(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** A dialog's accessible name: aria-label, aria-labelledby, or its first heading. */
function dialogName(dialog: Element): string {
  const labelled = squash(dialog.getAttribute("aria-label"));
  if (labelled) return labelled.slice(0, DIALOG_NAME_MAX);
  const ids = squash(dialog.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
  const byIds = squash(
    ids.map((id) => dialog.ownerDocument.getElementById(id)?.textContent ?? "").join(" "),
  );
  if (byIds) return byIds.slice(0, DIALOG_NAME_MAX);
  return squash(dialog.querySelector(HEADING_SELECTOR)?.textContent).slice(0, DIALOG_NAME_MAX);
}

function isFixed(el: Element): boolean {
  return el.ownerDocument.defaultView?.getComputedStyle(el).position === "fixed";
}

/**
 * A modal with no dialog markup: one fixed element fills the window and is on top
 * at every corner (its backdrop), while something else is on top at the centre.
 * The modal is the part of the page around that centre which sits beside the
 * backdrop (or the backdrop itself, when it holds the centre). Null when there is none.
 */
function backdropModal(doc: Document): Element | null {
  const view = doc.defaultView;
  if (!view || view.innerWidth <= 0 || view.innerHeight <= 0) return null;
  const width = view.innerWidth;
  const height = view.innerHeight;
  const inX = width * BACKDROP_PROBE_INSET;
  const inY = height * BACKDROP_PROBE_INSET;
  const corners = [
    doc.elementFromPoint(inX, inY),
    doc.elementFromPoint(width - inX, inY),
    doc.elementFromPoint(inX, height - inY),
    doc.elementFromPoint(width - inX, height - inY),
  ];
  const backdrop = corners[0];
  if (!backdrop || corners.some((corner) => corner !== backdrop)) return null;
  if (backdrop === doc.body || backdrop === doc.documentElement || !isFixed(backdrop)) return null;
  const box = backdrop.getBoundingClientRect();
  if (box.width < width * BACKDROP_MIN_COVER || box.height < height * BACKDROP_MIN_COVER) {
    return null;
  }
  const centre = doc.elementFromPoint(width / 2, height / 2);
  if (!centre || centre === backdrop) return null;
  if (composedContains(backdrop, centre)) return backdrop;
  const shared = composedParent(backdrop);
  let modal: Element = centre;
  for (let up = composedParent(modal); up && up !== shared; up = composedParent(modal)) {
    modal = up;
  }
  return composedParent(modal) === shared && modal !== doc.body ? modal : null;
}

/** The layers of one document, read once per serialization. */
function readLayers(doc: Document): PageLayers {
  const marked = deepQueryAll(doc, DIALOG_SELECTOR).filter(isShown);
  const inferred = marked.some(isModal) ? null : backdropModal(doc);
  const dialogs = inferred && !marked.includes(inferred) ? [...marked, inferred] : marked;
  const modals = dialogs.filter((dialog) => dialog === inferred || isModal(dialog));
  const names = new Map<Element, string>();
  const openDialogOf = (el: Element): Element | null =>
    dialogs.filter((dialog) => composedContains(dialog, el)).at(-1) ?? null;

  const hitCovered = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const view = doc.defaultView;
    if (!view || x < 0 || y < 0 || x > view.innerWidth || y > view.innerHeight) return false;
    const root = el.getRootNode() as Document | ShadowRoot;
    const top = root.elementFromPoint?.(x, y) ?? null;
    return top != null && top !== el && !el.contains(top) && !top.contains(el);
  };

  return {
    dialogOf(el) {
      const dialog = openDialogOf(el);
      if (!dialog) return null;
      if (!names.has(dialog)) names.set(dialog, dialogName(dialog));
      return names.get(dialog) ?? "";
    },
    covered(el) {
      if (!dialogs.length || openDialogOf(el)) return false;
      if (el.closest("[inert]")) return true;
      if (modals.length) return true;
      return hitCovered(el);
    },
  };
}

/** Layers per document, so same-origin frames are read against their own dialogs. */
export function pageLayers(): (el: Element) => PageLayers {
  const byDoc = new Map<Document, PageLayers>();
  return (el) => {
    const doc = el.ownerDocument;
    let layers = byDoc.get(doc);
    if (!layers) {
      layers = readLayers(doc);
      byDoc.set(doc, layers);
    }
    return layers;
  };
}
