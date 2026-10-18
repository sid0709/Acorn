/**
 * The page side of the quick text pass. It serializes the frame's DOM with Oak's serializer, and answers
 * small questions about one element by the number the serializer gave it: what it is, where it is, what
 * it holds. It never changes the page's values and raises no events of its own: typing and clicking are
 * the extension's real mouse and keyboard.
 */

import { serializeDom } from "../agent/prefill/dom-serializer";
import { resolveElementByNodeId } from "../agent/prefill/element-resolver";
import {
  PREFILL_MESSAGE,
  type ControlKind,
  type Described,
  type FrameCandidate,
  type FrameCandidates,
  type FrameReview,
  type GroupMember,
  type Located,
  type PrefillRequestMessage,
  type ProbeRead,
  type ReadBack,
  type ScannedFrame,
  type SerializedFrame,
} from "../agent/prefill/messages";
import { scanTree } from "../agent/prefill/scan";
import { PREFILL_LABEL_MAX_CHARS, PREFILL_PROBE_MAX } from "../agent/prefill/settings";

const STAMP = "data-acorn-id";

/** The text around an element that asks its question (Oak's `nearbyQuestionText`, plan-step-runner.ts). */
function nearbyQuestionText(el: Element, expectedLabel: string | null): string {
  const bits = [expectedLabel || ""];
  const html = el as HTMLElement;
  bits.push(html.getAttribute("aria-label") || "");
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i += 1) {
    bits.push(node.getAttribute("aria-label") || "");
    const heading = node.querySelector(
      ":scope > label, :scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4",
    );
    if (heading?.textContent) bits.push(heading.textContent);
    const prev = node.previousElementSibling as HTMLElement | null;
    if (prev) bits.push(prev.innerText || prev.textContent || "");
    node = node.parentElement;
  }
  return bits.join(" ");
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, PREFILL_LABEL_MAX_CHARS);
}

/** The words that name one option of a group. */
function optionLabel(input: HTMLInputElement): string {
  const own = clean(input.getAttribute("aria-label")) || clean(input.labels?.[0]?.textContent);
  if (own) return own;
  const next = input.nextSibling;
  const trailing = clean(
    next?.nodeType === Node.TEXT_NODE ? next.nodeValue : (next as HTMLElement | null)?.innerText,
  );
  return trailing || clean(input.value);
}

function nodeIdOf(el: Element): number {
  return Number(el.getAttribute(STAMP));
}

/** The other radio buttons of a group: same name, same form (or same document). */
function radioGroup(input: HTMLInputElement): HTMLInputElement[] {
  const root: ParentNode = input.form ?? (input.getRootNode() as Document | ShadowRoot);
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
    (other) => other.name === input.name,
  );
}

function describe(el: Element): Described {
  const question = nearbyQuestionText(el, null);
  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options)
      .filter((option) => option.value !== "")
      .map((option) => option.text.replace(/\s+/g, " ").trim());
    const chosen = el.selectedOptions[0];
    return {
      ok: true,
      kind: "select",
      empty: !chosen || chosen.value === "",
      question,
      options,
      members: [],
      maxLength: 0,
    };
  }
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    const inputs = el.type === "radio" && el.name ? radioGroup(el) : [el];
    const members: GroupMember[] = inputs
      .filter((input) => nodeIdOf(input) > 0)
      .map((input) => ({
        nodeId: nodeIdOf(input),
        label: optionLabel(input),
        checked: input.checked,
      }));
    return {
      ok: true,
      kind: el.type,
      empty: !members.some((member) => member.checked),
      question,
      options: [],
      members,
      maxLength: 0,
    };
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const kind: ControlKind = "text";
    return {
      ok: true,
      kind,
      empty: el.value.trim() === "",
      question,
      options: [],
      members: [],
      maxLength: el.maxLength > 0 ? el.maxLength : 0,
    };
  }
  return { ok: false, error: `a <${el.tagName.toLowerCase()}> is not a plain field` };
}

/** Whether the element at a point is the target, inside it, or the label of it. */
function hits(target: Element, point: Element | null): boolean {
  if (!point) return false;
  if (target.contains(point) || point.contains(target)) return true;
  const control = target as HTMLInputElement;
  if (Array.from(control.labels ?? []).some((label) => label.contains(point))) return true;
  return isTwin(target, point) || isOwnLayer(target, point);
}

/** How many times the field's own area the wrapper of its drawn layers may take: a page-wide layer is not its own. */
const OWN_LAYER_MAX_AREA_RATIO = 4;
const CONTROL_SELECTOR = "input:not([type=hidden]), select, textarea";

/**
 * A layer a widget draws over its own field (a formatted display over a transparent input): it sits in the
 * smallest wrapper that holds this one field and no other, and covers most of the field's box. A click on
 * it is a click on the field, so it does not count as something covering it. A banner or a dialog is in
 * no such wrapper, and a neighbouring field's wrapper holds that field too.
 */
function isOwnLayer(target: Element, point: Element): boolean {
  if (!target.matches(CONTROL_SELECTOR)) return false;
  const field = target.getBoundingClientRect();
  const fits = (el: Element) => {
    const box = el.getBoundingClientRect();
    return box.width * box.height <= OWN_LAYER_MAX_AREA_RATIO * field.width * field.height;
  };
  let wrapper: Element = target;
  while (
    wrapper.parentElement &&
    wrapper.parentElement.querySelectorAll(CONTROL_SELECTOR).length === 1 &&
    fits(wrapper.parentElement)
  ) {
    wrapper = wrapper.parentElement;
  }
  return (
    wrapper !== target &&
    wrapper.contains(point) &&
    mostlyOverlap(target.getBoundingClientRect(), point.getBoundingClientRect())
  );
}

/**
 * A clickable layer a page draws over a control, saying the same words in the same place: a click on
 * it is a click on the control, so it does not count as something covering it.
 */
function isTwin(target: Element, other: Element): boolean {
  const words = (el: Element) =>
    clean((el as HTMLElement).innerText || el.getAttribute("aria-label"));
  const text = words(target);
  return (
    text !== "" &&
    text === words(other) &&
    mostlyOverlap(target.getBoundingClientRect(), other.getBoundingClientRect())
  );
}

/** A point of the element's box that a click would reach the element at, in this frame's viewport. */
function locate(el: Element): Located {
  const control = el as HTMLInputElement;
  let target: Element = el;
  let rect = target.getBoundingClientRect();
  if ((rect.width <= 0 || rect.height <= 0) && control.labels?.[0]) {
    // A custom-drawn checkbox or radio: its input has no box, its label is what is clicked.
    target = control.labels[0];
    rect = target.getBoundingClientRect();
  }
  if (rect.width <= 0 || rect.height <= 0)
    return { ok: false, error: "the field has no box on the page" };
  const fractions: Array<[number, number]> = [
    [0.5, 0.5],
    [0.25, 0.5],
    [0.75, 0.5],
    [0.5, 0.25],
    [0.5, 0.75],
  ];
  for (const [fx, fy] of fractions) {
    const x = rect.left + rect.width * fx;
    const y = rect.top + rect.height * fy;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    if (hits(target, el.ownerDocument.elementFromPoint(x, y))) return { ok: true, x, y };
  }
  return { ok: false, error: "something covers the field or it is off the screen" };
}

function read(el: Element): ReadBack {
  if (el instanceof HTMLSelectElement) {
    const chosen = el.selectedOptions[0];
    const selected = chosen && chosen.value !== "" ? chosen.text.replace(/\s+/g, " ").trim() : "";
    return { ok: true, value: selected, checked: false, selected };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const checked = el instanceof HTMLInputElement && el.checked;
    return { ok: true, value: el.value, checked, selected: "" };
  }
  return { ok: false, error: "not a field" };
}

/** The offsets of the child frames that have announced themselves, by token. */
const probes = new Map<string, { x: number; y: number }>();
let probeListening = false;

function iframes(root: ParentNode, found: HTMLIFrameElement[] = []): HTMLIFrameElement[] {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el instanceof HTMLIFrameElement) found.push(el);
    if (el.shadowRoot) iframes(el.shadowRoot, found);
  }
  return found;
}

/** Remembers where the frame that posted a probe sits in this frame: the iframe whose window sent it. */
function listenForProbes(): void {
  if (probeListening) return;
  probeListening = true;
  window.addEventListener("message", (event: MessageEvent<{ acornProbe?: unknown }>) => {
    const token = event.data?.acornProbe;
    if (typeof token !== "string" || probes.size >= PREFILL_PROBE_MAX) return;
    const frame = iframes(document).find((candidate) => candidate.contentWindow === event.source);
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    probes.set(token, {
      x:
        rect.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0),
      y: rect.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0),
    });
  });
}

function scan(): ScannedFrame {
  try {
    return { ok: true, ...scanTree(serializeDom()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every element of the page, through open shadow roots. */
function everyElement(root: ParentNode = document, found: Element[] = []): Element[] {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    found.push(el);
    if (el.shadowRoot) everyElement(el.shadowRoot, found);
  }
  return found;
}

/** Whether a person could see the element: it has a box on the page and is not hidden by style. */
function shown(el: Element): boolean {
  const html = el as HTMLElement;
  if (!html.getClientRects || html.getClientRects().length === 0) return false;
  const rect = html.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function textOfIds(el: Element, attribute: string): string {
  return (el.getAttribute(attribute) ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** The words that name a field: its own label, else the title above it. */
function labelOf(el: Element): string {
  const input = el as HTMLInputElement;
  return (
    clean(el.getAttribute("aria-label")) ||
    clean(textOfIds(el, "aria-labelledby")) ||
    clean(input.labels?.[0]?.textContent) ||
    clean(el.getAttribute("placeholder")) ||
    clean(nearbyQuestionText(el, null)) ||
    clean(el.getAttribute("name"))
  );
}

function isRequired(el: Element): boolean {
  return (el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true";
}

/** The words a control shows. */
function controlText(el: Element): string {
  const input = el as HTMLInputElement;
  return (
    (el as HTMLElement).innerText ||
    input.value ||
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    ""
  );
}

/** A control that submits its form: a submit button or input, or an image button. */
function isSubmitControl(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.type === "submit" || el.type === "image";
  return el instanceof HTMLButtonElement && el.type === "submit";
}

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

const NOT_A_FIELD = new Set(["hidden", "submit", "button", "image", "reset"]);

/** What is left on this frame's page. A field is read as a person would: by what shows, not by what the page's script holds. */
function reviewFrame(): FrameReview {
  const empty: string[] = [];
  const errors: string[] = [];
  const blocked: string[] = [];
  let fields = 0;
  const groups = new Map<string, HTMLInputElement[]>();
  const unticked: HTMLInputElement[] = [];
  const add = (list: string[], text: string) => {
    if (text && !list.includes(text)) list.push(text);
  };
  for (const el of everyElement()) {
    if (el.getAttribute("aria-invalid") === "true" && shown(el)) {
      const message = clean(
        textOfIds(el, "aria-errormessage") || textOfIds(el, "aria-describedby"),
      );
      add(errors, message ? `${labelOf(el)}: ${message}` : labelOf(el));
    } else if (el.getAttribute("role") === "alert" && shown(el)) {
      add(errors, clean(el.textContent));
    }
    // A control that submits its form and cannot be pressed: something it needs is not done.
    if (isSubmitControl(el) && isDisabled(el) && shown(el)) {
      add(blocked, `a control that continues is disabled: ${clean(controlText(el))}`);
    }
    if (!(
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ))
      continue;
    const type = el instanceof HTMLInputElement ? el.type : "";
    if (
      el.disabled ||
      NOT_A_FIELD.has(type) ||
      !(shown(el) || ((el.labels ?? []).length > 0 && shown(el.labels![0])))
    )
      continue;
    fields += 1;
    if (type === "checkbox" && el instanceof HTMLInputElement && !el.checked) unticked.push(el);
    if (!isRequired(el)) continue;
    if (type === "radio" && el instanceof HTMLInputElement) {
      groups.set(el.name || `${groups.size}`, [...(groups.get(el.name) ?? []), el]);
    } else if (type === "checkbox" && el instanceof HTMLInputElement) {
      if (!el.checked) add(empty, labelOf(el));
    } else if (type === "file" && el instanceof HTMLInputElement) {
      if (!el.files?.length) add(empty, labelOf(el));
    } else if (el instanceof HTMLSelectElement) {
      const chosen = el.selectedOptions[0];
      if (!chosen || chosen.value === "") add(empty, labelOf(el));
    } else if (el.value.trim() === "") {
      add(empty, labelOf(el));
    }
  }
  for (const radios of groups.values()) {
    if (!radios.some((radio) => radio.checked))
      add(empty, clean(groupQuestionOf(radios[0])) || labelOf(radios[0]));
  }
  // With the continue control disabled, a box nobody ticked may be what it waits for (a page does not
  // always mark such a box required): they are listed as suspects, and only then, so that an optional
  // box left alone is no problem on a page that can go on.
  if (blocked.length > 0) {
    for (const box of unticked) add(blocked, `unticked: ${labelOf(box)}`);
  }
  return { ok: true, fields, empty, errors, blocked };
}

/** The question a group of options answers. */
function groupQuestionOf(input: HTMLInputElement): string {
  const group = input.closest("fieldset, [role=radiogroup], [role=group]");
  return (
    clean(group?.querySelector("legend")?.textContent) ||
    clean(group?.getAttribute("aria-label")) ||
    clean(group ? textOfIds(group, "aria-labelledby") : "") ||
    clean(nearbyQuestionText(input, null))
  );
}

const MAX_CANDIDATES = 40;

/** Whether two boxes overlap by more than half of the smaller one. */
function mostlyOverlap(a: DOMRect, b: DOMRect): boolean {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return false;
  return width * height > 0.5 * Math.min(a.width * a.height, b.width * b.height);
}

/** Whether the element is a control the browser itself draws (a button or an input), not a role on another element. */
function isNativeControl(el: Element): boolean {
  return el instanceof HTMLButtonElement || el instanceof HTMLInputElement;
}

/**
 * The controls of this frame's page that could be pressed, with the numbers the serializer gave them.
 * A page may draw one control twice: a native button and a clickable layer over it with the same words.
 * They are one control, so they are listed once (the native one, when there is one): otherwise the
 * decision model splits its certainty between them.
 */
function candidatesFrame(): FrameCandidates {
  try {
    serializeDom();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  type Found = FrameCandidate & { el: Element; rect: DOMRect };
  const found: Found[] = [];
  for (const el of everyElement()) {
    const input = el as HTMLInputElement;
    const isInput =
      el instanceof HTMLInputElement && ["submit", "button", "image"].includes(input.type);
    if (!(el instanceof HTMLButtonElement || isInput || el.getAttribute("role") === "button"))
      continue;
    const disabled =
      (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
    const nodeId = nodeIdOf(el);
    if (disabled || !nodeId || !shown(el)) continue;
    const text = clean(
      (el as HTMLElement).innerText ||
        input.value ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title"),
    );
    if (!text) continue;
    const submits = isInput
      ? input.type === "submit" || input.type === "image"
      : el instanceof HTMLButtonElement && el.type === "submit";
    found.push({
      nodeId,
      text,
      kind: submits ? "submit" : "button",
      inForm: Boolean(el.closest("form")),
      el,
      rect: el.getBoundingClientRect(),
    });
  }
  const distinct: Found[] = [];
  for (const candidate of found) {
    const twin = distinct.findIndex(
      (other) => other.text === candidate.text && mostlyOverlap(other.rect, candidate.rect),
    );
    if (twin < 0) distinct.push(candidate);
    else if (!isNativeControl(distinct[twin].el) && isNativeControl(candidate.el)) {
      distinct[twin] = candidate;
    }
  }
  // The controls of the form first: a page's navigation and banners can fill the list.
  distinct.sort((a, b) => Number(b.inForm) - Number(a.inForm));
  return {
    ok: true,
    candidates: distinct
      .slice(0, MAX_CANDIDATES)
      .map(({ nodeId, text, kind, inForm }) => ({ nodeId, text, kind, inForm })),
  };
}

function serialize(): SerializedFrame {
  try {
    return { ok: true, url: location.href, title: document.title, tree: serializeDom() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function answer(message: PrefillRequestMessage): unknown {
  switch (message.type) {
    case PREFILL_MESSAGE.scan:
      return scan();
    case PREFILL_MESSAGE.review:
      return reviewFrame();
    case PREFILL_MESSAGE.candidates:
      return candidatesFrame();
    case PREFILL_MESSAGE.serialize:
      return serialize();
    case PREFILL_MESSAGE.armProbe:
      listenForProbes();
      return { ok: true };
    case PREFILL_MESSAGE.sendProbe:
      if (window.parent !== window) window.parent.postMessage({ acornProbe: message.token }, "*");
      return { ok: true };
    case PREFILL_MESSAGE.readProbe: {
      const found = probes.get(message.token);
      probes.delete(message.token);
      return {
        ok: true,
        found: Boolean(found),
        x: found?.x ?? 0,
        y: found?.y ?? 0,
      } satisfies ProbeRead;
    }
    default:
      break;
  }
  const el = resolveElementByNodeId(message.nodeId);
  if (!el) return { ok: false, error: "the page no longer has this element" };
  switch (message.type) {
    case PREFILL_MESSAGE.describe:
      return describe(el);
    case PREFILL_MESSAGE.reveal:
      el.scrollIntoView({ block: "center", inline: "nearest" });
      return { ok: true };
    case PREFILL_MESSAGE.locate:
      return locate(el);
    default:
      return read(el);
  }
}

const MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(PREFILL_MESSAGE));

/** Answers the extension's questions about this frame. */
export function initPrefillBridge(): void {
  chrome.runtime.onMessage.addListener((message: PrefillRequestMessage, _sender, sendResponse) => {
    if (!message || !MESSAGE_TYPES.has(message.type)) return false;
    sendResponse(answer(message));
    return false;
  });
}
