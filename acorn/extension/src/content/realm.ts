/**
 * DOM class checks that hold across documents. A same-origin iframe's elements are built
 * from that frame's own `HTMLInputElement`, `Element`, …, so `el instanceof HTMLInputElement`
 * in this frame's script is false for them: a form inside an iframe the page fills itself
 * would read as no fields, refuse a fill, lose its labels' text and not be clicked. A
 * frame that runs its own content script works in its own realm; one that does not is read
 * by its parent, and every check on its elements goes through here.
 */

type DomClass<T> = (abstract new (...args: never[]) => T) & { name: string };

/** The constructor `name` has in the window that owns `value`, or null when it is this one. */
function ownerRealmClass(value: object, name: string): DomClass<unknown> | null {
  const node = value as { nodeType?: number; ownerDocument?: Document | null };
  const doc = node.nodeType === Node.DOCUMENT_NODE ? (value as Document) : node.ownerDocument;
  const view = doc?.defaultView as (Window & Record<string, unknown>) | null | undefined;
  if (!view || (view as unknown) === window) return null;
  try {
    const foreign = view[name];
    return typeof foreign === "function" ? (foreign as DomClass<unknown>) : null;
  } catch {
    // A frame of another origin is not readable at all.
    return null;
  }
}

/** `value instanceof DomClass`, in this frame's realm or the one the value belongs to. */
export function isA<T>(value: unknown, domClass: DomClass<T>): value is T {
  if (value == null || typeof value !== "object") return false;
  if (value instanceof domClass) return true;
  const foreign = ownerRealmClass(value, domClass.name);
  return foreign != null && value instanceof foreign;
}
