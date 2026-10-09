/**
 * Custom-element controls. Many design systems build a button as a custom element
 * whose open shadow root holds a native button or link around a <slot>: the
 * element's own text is the label, the native control inside does the work.
 * Structural only: no tag names, classes, or wording.
 */

/** Native controls (and their ARIA equivalents) a person presses. */
const NATIVE_CONTROL_SELECTOR =
  'button, a[href], input[type="submit"], input[type="button"], [role="button"], [role="link"]';

/**
 * The native control inside el's shadow root that renders el's own content (it
 * holds a <slot>), or null when el is not such a wrapper.
 */
export function shadowDelegate(el: Element): HTMLElement | null {
  const root = el.shadowRoot;
  if (!root) return null;
  for (const candidate of Array.from(root.querySelectorAll(NATIVE_CONTROL_SELECTOR))) {
    if (candidate instanceof HTMLElement && candidate.querySelector("slot")) return candidate;
  }
  return null;
}

/** The role a wrapper takes from the control inside it. */
export function delegatedRole(delegate: Element): "button" | "link" {
  const role = delegate.getAttribute("role");
  if (role === "link" || role === "button") return role;
  return delegate.tagName === "A" ? "link" : "button";
}

/** Every element matching selector in root and in the open shadow roots under it. */
export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const found = Array.from(root.querySelectorAll(selector));
  const hosts = Array.from(root.querySelectorAll("*"));
  if (root instanceof Element) hosts.unshift(root);
  for (const el of hosts) {
    if (el.shadowRoot) found.push(...deepQueryAll(el.shadowRoot, selector));
  }
  return found;
}

/** The element with this id in el's own shadow root, else in its document. */
export function byIdNear(el: Element, id: string): Element | null {
  const root = el.getRootNode();
  const near = root instanceof ShadowRoot ? root.getElementById(id) : null;
  return near ?? el.ownerDocument.getElementById(id);
}

/**
 * The element's parent as the page is drawn: the slot it is shown in when a shadow
 * root projects it, else its parent, else (atop a shadow root) that root's host.
 * A dialog drawn by a custom element holds its slotted buttons only this way.
 */
export function composedParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Whether ancestor holds el, looking through shadow roots. */
export function composedContains(ancestor: Element, el: Element): boolean {
  for (let node: Element | null = el; node; node = composedParent(node)) {
    if (node === ancestor) return true;
  }
  return false;
}

/** Elements whose content is never drawn as text. */
const NO_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

/**
 * An element's text as the page draws it: through open shadow roots, and with
 * each <slot> showing the nodes projected into it. textContent and innerText miss
 * both, so a custom element's label or option reads as empty or as just "*".
 */
export function drawnText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element) || NO_TEXT_TAGS.has(node.tagName)) return;
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true });
      for (const child of assigned.length ? assigned : Array.from(node.childNodes)) walk(child);
      return;
    }
    const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
    for (const child of Array.from(children)) walk(child);
  };
  walk(el);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** The nearest element matching selector at or above el, as the page is drawn. */
export function composedClosest(el: Element, selector: string): Element | null {
  for (let node: Element | null = el; node; node = composedParent(node)) {
    if (node.matches(selector)) return node;
  }
  return null;
}
