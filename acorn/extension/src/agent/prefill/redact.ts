/**
 * What the serialized page must not carry to the server. The serializer reports each field's live value;
 * a password, a code, a card number, or a hidden token is not for a model to read, and the pass types
 * into none of them. They are removed from the tree here, after it is serialized and before it is sent.
 */

import type { DomNode } from "./dom-types";

/** Input types whose value is never sent. */
const SECRET_TYPES = new Set(["password", "hidden"]);
/** `autocomplete` tokens of a field that holds a secret: a one-time code, or a card's number, code or expiry. */
const SECRET_AUTOCOMPLETE = /^(one-time-code|cc-)/;

function holdsSecret(node: DomNode): boolean {
  if (node.tag !== "input") return false;
  const type = (node.attrs?.type ?? "").toLowerCase();
  if (SECRET_TYPES.has(type)) return true;
  return (node.attrs?.autocomplete ?? "")
    .toLowerCase()
    .split(/\s+/)
    .some((token) => SECRET_AUTOCOMPLETE.test(token));
}

/** The tree with the value of every secret field removed. The tree itself is not changed. */
export function withoutSecrets(node: DomNode): DomNode {
  const children = node.children.map(withoutSecrets);
  if (!holdsSecret(node) || !node.attrs?.value) return { ...node, children };
  const { value: _value, ...attrs } = node.attrs;
  return { ...node, attrs, children };
}
