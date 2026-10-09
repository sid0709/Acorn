import { drawnText } from "../shadow-control";

export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Text with a letter or digit: a lone required mark ("*") or colon names nothing. */
const NAMES_SOMETHING = /[\p{L}\p{N}]/u;

function pushLabel(labels: string[], value: string | null | undefined): void {
  const text = value?.replace(/\s+/g, " ").trim();
  if (text && NAMES_SOMETHING.test(text)) labels.push(text);
}

const FIELD_TITLE_TAGS = /^(LABEL|LEGEND|H1|H2|H3|H4|H5|H6|P|SPAN|STRONG|DIV|DT|DD)$/;
const FIELD_TITLE_SNIPPET_CHARS = 240;

function pushFieldTitle(labels: string[], raw: string | null | undefined): void {
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text) return;
  pushLabel(labels, text.slice(0, FIELD_TITLE_SNIPPET_CHARS));
}

/** Native labeled control when the planned node is a <label>, not the input. */
export function associatedControl(el: Element): Element | null {
  if (!(el instanceof HTMLLabelElement)) return null;
  if (el.control) return el.control;
  return el.querySelector("input, select, textarea, button");
}

/** Field titles often live on siblings/ancestors, not on the control itself (e.g. file "Attach"). */
function ancestorFieldLabels(el: Element): string[] {
  const labels: string[] = [];
  let node: Element | null = el.parentElement;
  let depth = 0;

  while (node && depth < 7) {
    pushLabel(labels, node.getAttribute("aria-label"));

    for (const child of Array.from(node.children)) {
      if (child === el || child.contains(el)) continue;
      const tag = child.tagName.toUpperCase();
      if (!FIELD_TITLE_TAGS.test(tag)) continue;
      const html = child as HTMLElement;
      const hasNestedControl = Boolean(child.querySelector("input, select, textarea, button, a"));
      if (hasNestedControl && tag !== "LABEL" && tag !== "LEGEND") continue;
      pushFieldTitle(labels, html.innerText || html.textContent);
    }

    const prev = node.previousElementSibling;
    if (prev && FIELD_TITLE_TAGS.test(prev.tagName.toUpperCase())) {
      pushFieldTitle(labels, (prev as HTMLElement).innerText || prev.textContent);
    }

    node = node.parentElement;
    depth += 1;
  }

  return labels;
}

/** The one element with this id in el's own tree; null when none or several share it. */
export function uniqueById(el: Element, id: string): Element | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.querySelectorAll !== "function") return null;
  const found = root.querySelectorAll(`#${CSS.escape(id)}`);
  return found.length === 1 ? found[0] : null;
}

/**
 * The label a `for` attribute ties to this control. A page that reuses one id on
 * several controls points every `for` at the first of them, so a label counts only
 * when the id names this control alone.
 */
export function forLabelOf(el: Element): string | null | undefined {
  if (!el.id) return null;
  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.querySelectorAll !== "function") return null;
  const selector = `label[for="${CSS.escape(el.id)}"]`;
  const label =
    uniqueById(el, el.id) === el ? root.querySelector(selector) : nearestSharedLabel(el, selector);
  return label ? drawnText(label) : null;
}

/**
 * With an id reused across fields, the label meant for this control is the one in
 * its own part of the page: the first ancestor holding a matching label must hold
 * exactly one, and no other control carrying the same id.
 */
function nearestSharedLabel(el: Element, selector: string): Element | null {
  const idSelector = `#${CSS.escape(el.id)}`;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const labels = node.querySelectorAll(selector);
    if (!labels.length) continue;
    const others = Array.from(node.querySelectorAll(idSelector)).filter((other) => other !== el);
    return labels.length === 1 && !others.length ? labels[0] : null;
  }
  return null;
}

export function labelCandidates(el: Element): string[] {
  const html = el as HTMLElement;
  const primary: string[] = [];
  const own: string[] = [];

  pushLabel(primary, html.getAttribute?.("aria-label"));

  // A reused id resolves to another field's text, so it names nothing here.
  const labelledBy = html.getAttribute?.("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
      const named = uniqueById(el, id);
      pushLabel(primary, named ? drawnText(named) : null);
    }
  }

  pushLabel(primary, forLabelOf(el));

  const wrappingLabel = html.closest?.("label");
  if (wrappingLabel) {
    pushLabel(primary, drawnText(wrappingLabel));
  }

  pushLabel(primary, html.getAttribute?.("placeholder"));
  pushLabel(primary, html.getAttribute?.("name"));

  const fieldset = html.closest?.("fieldset");
  pushLabel(primary, fieldset?.querySelector?.("legend")?.textContent);

  const prev = html.previousElementSibling;
  if (prev && FIELD_TITLE_TAGS.test(prev.tagName.toUpperCase())) {
    pushFieldTitle(primary, (prev as HTMLElement).innerText || prev.textContent);
  }

  for (const label of ancestorFieldLabels(el)) {
    pushLabel(primary, label);
  }

  const ownText = (html.innerText || html.textContent || "").trim();
  if (ownText && ownText.length < 200) own.push(ownText);

  // Keep control chrome text ("Attach", "Select...") last so field titles win.
  return [...new Set([...primary, ...own].filter(Boolean))];
}
