import { childDocument } from "./frame-reach";

/** Document, open shadow roots, and the child frames this frame reads — the same reach as the serializer. */
export function queryDeep(root: ParentNode, selector: string, out: Element[] = []): Element[] {
  out.push(...Array.from(root.querySelectorAll(selector)));
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.shadowRoot) queryDeep(el.shadowRoot, selector, out);
    const doc = childDocument(el);
    if (doc) queryDeep(doc, selector, out);
  }
  return out;
}
