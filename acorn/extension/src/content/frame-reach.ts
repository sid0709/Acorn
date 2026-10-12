/**
 * Which documents this frame reads as its own page. A same-origin child frame
 * whose own Acorn content script runs answers for itself: its elements are read,
 * numbered, and pressed only from inside it, in its own realm, where the content
 * code's checks (`instanceof HTMLElement` and the like) hold. A parent that read
 * them would number elements it cannot press. A child with no script of its own
 * (a blank widget frame the page fills) is still read as part of its parent.
 */

/** Set on the root element of a document whose frame runs its own content script. */
const OWN_SCRIPT_ATTR = "data-acorn-frame";

/** Say this frame's document is read and worked by its own content script. */
export function claimOwnDocument(doc: Document = document): void {
  doc.documentElement?.setAttribute(OWN_SCRIPT_ATTR, "");
}

/** The document inside a frame element that this frame reads as part of its page; null otherwise. */
export function childDocument(frame: Element): Document | null {
  if (frame.tagName !== "IFRAME") return null;
  try {
    const doc = (frame as HTMLIFrameElement).contentDocument;
    if (!doc?.documentElement || doc.documentElement.hasAttribute(OWN_SCRIPT_ATTR)) return null;
    return doc;
  } catch {
    // Cross-origin frame.
    return null;
  }
}
