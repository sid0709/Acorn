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

/**
 * A page can write its frame's document anew after the script started (document.open
 * and write, which gives it a fresh root element): the claim goes with the old root, and
 * the parent would then read the frame's elements itself. The claim is made again
 * whenever the root is replaced.
 */
export function keepOwnDocumentClaimed(doc: Document = document): void {
  new MutationObserver(() => {
    if (doc.documentElement && !doc.documentElement.hasAttribute(OWN_SCRIPT_ATTR)) {
      claimOwnDocument(doc);
    }
  }).observe(doc, { childList: true });
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
