/**
 * Which controls sit inside an open dialog, and which an open dialog covers so a
 * person could not click them. Structural only: native <dialog>, ARIA dialog roles
 * and aria-modal, inert subtrees, and what the browser reports on top at a
 * control's centre. No class names, ids, or wording.
 */

/** Elements that are a dialog while they are shown. */
const DIALOG_SELECTOR = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
/** Headings that name a dialog with no accessible name of its own. */
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
/** Longest dialog name kept. */
const DIALOG_NAME_MAX = 80;

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

/** The layers of one document, read once per serialization. */
function readLayers(doc: Document): PageLayers {
  const dialogs = Array.from(doc.querySelectorAll(DIALOG_SELECTOR)).filter(isShown);
  const modals = dialogs.filter(isModal);
  const names = new Map<Element, string>();
  const openDialogOf = (el: Element): Element | null =>
    dialogs.filter((dialog) => dialog.contains(el)).at(-1) ?? null;

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
