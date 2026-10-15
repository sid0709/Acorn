/**
 * Generic DOM reading for form fields, shared by Refill's error scan and the fast
 * planner's field list: visibility, open shadow roots and same-origin frames,
 * radio/checkbox groups, each control's own field wrapper, and its question label.
 * Structural only — no host class names or copy.
 */

import { isListOpener } from "./agents/combobox/list-opener";
import { getDirectText } from "./dom-serializer";
import { FILLABLE_SELECTOR } from "./form-frame";
import { queryDeep } from "./query-deep";
import { isA } from "./realm";
import { composedClosest, drawnText } from "./shadow-control";
import {
  forLabelElementOf,
  hostLabelElementOf,
  labelCandidates,
  uniqueById,
} from "./verify/element-labels";
import { inferRole } from "./verify/element-role";

export { ACORN_ID_ATTR } from "./acorn-id";
export { queryDeep } from "./query-deep";

/** How far up from a control to look for its own field wrapper. */
const MAX_WRAPPER_DEPTH = 6;
/** Labels and messages longer than this are clipped. */
export const MAX_TEXT_CHARS = 200;
/** Option lists and choice labels belong to the control, not to its error text. */
const CONTROL_PART_SELECTOR =
  'label, option, select, [role="option"], [role="listbox"], [role="radio"], [role="checkbox"], [role="menu"], [role="menuitem"]';
const CHOICE_TYPES = new Set(["radio", "checkbox"]);

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isVisible(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

/** Smallest box, in px, a person can see and type into. */
const MIN_FIELD_PX = 2;

/**
 * Whether the field itself is fully transparent. Only its own opacity counts: a
 * dialog fading in animates its container, and its fields are still real.
 */
function isTransparent(el: Element): boolean {
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  return Boolean(style && Number(style.opacity) === 0);
}

/**
 * A text field a person can see and type into: visible, not fully transparent,
 * bigger than a pixel or two, and not placed outside the page. A field built for
 * robots to fill (and people to leave empty) fails one of these.
 */
export function isPersonFacing(el: Element): boolean {
  if (!isVisible(el) || isTransparent(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_FIELD_PX || rect.height < MIN_FIELD_PX) return false;
  const view = el.ownerDocument?.defaultView;
  return rect.right + (view?.scrollX ?? 0) > 0 && rect.bottom + (view?.scrollY ?? 0) > 0;
}

export function matchesSafe(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false; // Selector unsupported by this browser.
  }
}

/** Containers whose accessible name is the question their controls answer. */
export const NAMED_GROUP_SELECTOR = 'fieldset, [role="group"], [role="radiogroup"]';

/**
 * A named group (fieldset, role=group) holding several checkboxes and no other
 * control: one question whose boxes may each carry their own name ("Black",
 * "Caribbean"), so the name alone does not group them.
 */
function checkboxSetGroup(el: Element): Element | null {
  if (!isA(el, HTMLInputElement) || el.type !== "checkbox") return null;
  const group = el.closest(NAMED_GROUP_SELECTOR);
  if (!group) return null;
  const controls = Array.from(group.querySelectorAll(FILLABLE_SELECTOR));
  const onlyBoxes = controls.every(
    (control) => isA(control, HTMLInputElement) && control.type === "checkbox",
  );
  return onlyBoxes && controls.length > 1 ? group : null;
}

function isNamelessRadio(el: Element): el is HTMLInputElement {
  return isA(el, HTMLInputElement) && el.type === "radio" && !el.name;
}

/**
 * Radios with no shared name (a script, not the browser, makes them exclusive):
 * the nearest container holding more than one control, when every control in it
 * is such a radio, is one question.
 */
function namelessRadioSet(el: Element): Element | null {
  if (!isNamelessRadio(el)) return null;
  let node = el.parentElement;
  for (let depth = 0; node && depth < MAX_WRAPPER_DEPTH; depth += 1) {
    if (node === node.ownerDocument.body) return null;
    const controls = Array.from(node.querySelectorAll(FILLABLE_SELECTOR));
    if (controls.length > 1) return controls.every(isNamelessRadio) ? node : null;
    node = node.parentElement;
  }
  return null;
}

/** A choice question its controls' names do not tie together. */
function choiceSetGroup(el: Element): Element | null {
  return checkboxSetGroup(el) ?? namelessRadioSet(el);
}

/** Stable per-page keys for choice-set groups, which have no shared name to key by. */
const groupKeys = new WeakMap<Element, string>();
let nextGroupKey = 0;

function choiceSetKey(group: Element): string {
  let key = groupKeys.get(group);
  if (!key) {
    nextGroupKey += 1;
    key = `choice-set:${nextGroupKey}`;
    groupKeys.set(group, key);
  }
  return key;
}

export function choiceGroupKey(el: Element): string | null {
  if (!isA(el, HTMLInputElement) || !CHOICE_TYPES.has(el.type)) return null;
  const set = choiceSetGroup(el);
  if (set) return choiceSetKey(set);
  return el.name ? `${el.type}:${el.form?.id ?? ""}:${el.name}` : null;
}

/** Distinct questions inside `root`: a radio/checkbox group or a combobox+listbox pair counts once. */
export function distinctFieldCount(root: Element): number {
  const controls = Array.from(root.querySelectorAll(FILLABLE_SELECTOR));
  const outer = controls.filter(
    (el) => !controls.some((other) => other !== el && other.contains(el)),
  );
  const hasCombobox = outer.some((el) => inferRole(el) === "combobox");
  const keys = new Set<unknown>();
  for (const el of outer) {
    if (hasCombobox && el.getAttribute("role") === "listbox") continue;
    keys.add(choiceGroupKey(el) ?? el);
  }
  return keys.size;
}

/** The highest ancestor that still holds only this one question. */
export function fieldWrapper(control: Element): Element {
  let wrapper: Element = control;
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_WRAPPER_DEPTH; depth += 1) {
    if (node === node.ownerDocument.body || distinctFieldCount(node) > 1) break;
    wrapper = node;
    node = node.parentElement;
  }
  return wrapper;
}

/**
 * Whether text says anything: it has a letter or a digit. A lone required mark ("✱",
 * "*") or a colon sits beside a question and is never the question.
 */
export function carriesWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Visible wrapper text before or after the control, outside any control part. */
export function wrapperTexts(
  control: Element,
  wrapper: Element,
  position: number,
  skip: Set<string>,
): string[] {
  if (wrapper === control) return [];
  const texts: string[] = [];
  for (const el of Array.from(wrapper.querySelectorAll("*"))) {
    if (el === control || control.contains(el) || el.contains(control)) continue;
    if (!(control.compareDocumentPosition(el) & position)) continue;
    if (matchesSafe(el, FILLABLE_SELECTOR) || el.closest(CONTROL_PART_SELECTOR)) continue;
    const text = getDirectText(el);
    if (!text || !carriesWords(text) || skip.has(normalize(text)) || !isVisible(el)) continue;
    skip.add(normalize(text));
    texts.push(clip(text, MAX_TEXT_CHARS));
  }
  return texts;
}

/** How far up from a group the text that asks its question is looked for. */
const QUESTION_CLIMB_LEVELS = 4;
/** Elements that are a field's controls or options, never the words that ask its question. */
const CONTROL_HOLDER_SELECTOR = "input, select, textarea, button";

/**
 * The words that ask a group's question when they are not a label, legend, or heading:
 * the nearest element before the group that holds no control (a group's options and
 * other questions' options all do), looked for from the group's first option outward.
 * Its own text is the question; a required mark inside it is not part of it.
 */
export function questionBeforeGroup(members: Element[]): string {
  const element = questionElementBeforeGroup(members);
  if (!element) return "";
  return clip(getDirectText(element) || (element.textContent ?? ""), MAX_TEXT_CHARS);
}

/** The element questionBeforeGroup reads: the nearest words before the group that hold no control. */
function questionElementBeforeGroup(members: Element[]): Element | null {
  const first = members[0];
  let node: Element | null = first;
  for (let level = 0; node && level < QUESTION_CLIMB_LEVELS; level += 1) {
    for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
      if (prev.matches(CONTROL_HOLDER_SELECTOR) || prev.querySelector(CONTROL_HOLDER_SELECTOR)) {
        continue;
      }
      const text = getDirectText(prev) || (prev.textContent ?? "");
      if (carriesWords(text) && isVisible(prev)) return prev;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * A radio/checkbox group's question: its own label names one option ("Yes"),
 * so read the nearest text before the group inside the group's wrapper.
 */
export function fieldLabel(control: Element, members: Element[], wrapper: Element): string {
  if (members.length > 1) {
    const question =
      groupAccessibleName(control) ||
      groupQuestion(wrapper, control, members) ||
      wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_PRECEDING, new Set()).at(-1) ||
      questionBeforeGroup(members);
    if (question) return question;
  }
  return clip(labelCandidates(control)[0] ?? "", MAX_TEXT_CHARS);
}

/**
 * The accessible name of the group a control sits in (ARIA): aria-labelledby,
 * aria-label, or a fieldset's legend. "" when the control is in no named group.
 */
export function groupAccessibleName(control: Element, max: number = MAX_TEXT_CHARS): string {
  // Drawn ancestors: a custom element's group can project its options through a slot.
  const group = composedClosest(control, NAMED_GROUP_SELECTOR);
  if (!group) return "";
  const ids = (group.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  const byIds = ids
    .map((id) => {
      const named = uniqueById(group, id);
      return named ? drawnText(named) : "";
    })
    .join(" ");
  const legend = isA(group, HTMLFieldSetElement)
    ? group.querySelector(":scope > legend")?.textContent
    : "";
  return clip(byIds || group.getAttribute("aria-label") || legend || "", max);
}

/** How far up from a field the small group it is one part of is looked for. */
const PART_GROUP_DEPTH = 4;
/** A group whose parts make one answer (a date, a phone) holds a few fields, no more. */
const PART_GROUP_MAX_FIELDS = 4;

/** The name a container gives itself: aria-label, aria-labelledby, or a fieldset's legend. */
function containerName(node: Element): string {
  const ids = (node.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  const byIds = ids.map((id) => uniqueById(node, id)?.textContent ?? "").join(" ");
  const legend = isA(node, HTMLFieldSetElement)
    ? node.querySelector(":scope > legend")?.textContent
    : "";
  return clip(node.getAttribute("aria-label") || byIds || legend || "", MAX_TEXT_CHARS);
}

/**
 * The name of the small group a field is one part of — a date's Month inside
 * "Start Date", a phone's country code inside "Phone" — as the group names itself.
 * "" when the field stands alone: a bare "Month" does not say whose month it is.
 */
export function partGroupName(control: Element): string {
  let node = control.parentElement;
  for (let depth = 0; node && depth < PART_GROUP_DEPTH; depth += 1) {
    const fields = distinctFieldCount(node);
    if (fields > PART_GROUP_MAX_FIELDS) return "";
    const name = fields > 1 ? containerName(node) : "";
    if (name) return name;
    node = node.parentElement;
  }
  return "";
}

/** A part's label with the name of the group it belongs to, unless the label says it already. */
export function withPartGroup(control: Element, label: string): string {
  const group = partGroupName(control);
  if (!group || normalize(label).includes(normalize(group))) return label;
  return label ? `${group} — ${label}` : group;
}

/** How far up from a control to look for its section's heading. */
const MAX_SECTION_DEPTH = 12;
const SECTION_TITLE_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"], legend';

/**
 * The heading of the form section a control sits in: the nearest heading or
 * legend before it, found in its closest ancestor that has one. It tells the same
 * label apart in different sections ("First Name" under References).
 */
export function sectionTitle(control: Element): string {
  return headingSection(control) || drawnSection(control);
}

/** Title text this short is a title; anything longer is copy. */
const TITLE_BLOCK_MAX_CHARS = 60;
/** How much larger than the text people type a title is drawn. */
const TITLE_SIZE_RATIO = 1.25;
/** The size taken for typed text when the page has no field to measure. */
const DEFAULT_TEXT_PX = 16;
/** A page redraws itself: the title blocks found are kept this long. */
const TITLE_BLOCKS_TTL_MS = 500;

type TitleBlock = { el: Element; text: string };
const titleBlockCache = new WeakMap<Document, { at: number; blocks: TitleBlock[] }>();

function pixels(value: string | undefined): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * The blocks of a document drawn as titles: a short run of words with no control inside,
 * set larger than the text people type into its fields. A page that titles its sections
 * with plain boxes (no heading tag, no legend, no role) is read by how it draws them.
 */
function titleBlocksOf(doc: Document): TitleBlock[] {
  const cached = titleBlockCache.get(doc);
  if (cached && Date.now() - cached.at < TITLE_BLOCKS_TTL_MS) return cached.blocks;
  const view = doc.defaultView;
  const sizes = queryDeep(doc, "input, textarea, select")
    .map((field) => pixels(view?.getComputedStyle(field).fontSize))
    .filter((size) => size > 0)
    .sort((a, b) => a - b);
  const base = sizes[Math.floor(sizes.length / 2)] || DEFAULT_TEXT_PX;
  const blocks: TitleBlock[] = [];
  for (const el of queryDeep(doc, "div, span, p, strong, b")) {
    const text = getDirectText(el, TITLE_BLOCK_MAX_CHARS + 1);
    if (!text || text.length > TITLE_BLOCK_MAX_CHARS || !carriesWords(text)) continue;
    if (el.querySelector(CONTROL_HOLDER_SELECTOR) || !isVisible(el)) continue;
    if (pixels(view?.getComputedStyle(el).fontSize) < base * TITLE_SIZE_RATIO) continue;
    blocks.push({ el, text });
  }
  titleBlockCache.set(doc, { at: Date.now(), blocks });
  return blocks;
}

/** The nearest block drawn as a title before the control, in the control's own document. */
function drawnSection(control: Element): string {
  const blocks = titleBlocksOf(control.ownerDocument);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const { el, text } = blocks[i];
    if (el.ownerDocument !== control.ownerDocument || el.contains(control)) continue;
    if (control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
      return clip(text, MAX_TEXT_CHARS);
    }
  }
  return "";
}

/** The nearest heading element (h1-h6, role=heading, legend) before the control. */
function headingSection(control: Element): string {
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_SECTION_DEPTH; depth += 1) {
    const headings = Array.from(node.querySelectorAll(SECTION_TITLE_SELECTOR)).filter(
      (el) =>
        !el.contains(control) &&
        Boolean(control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) &&
        isVisible(el),
    );
    const nearest = headings.at(-1);
    if (nearest) return clip(nearest.textContent || "", MAX_TEXT_CHARS);
    node = node.parentElement;
  }
  return "";
}

/** Elements that title a field: a legend, a heading, or a label. */
const QUESTION_SELECTOR = 'legend, label, h1, h2, h3, h4, h5, h6, [role="heading"]';

/**
 * The question a group of options answers: the nearest legend, heading, or label
 * before the first option inside the field's wrapper — skipping labels that name
 * one of the options themselves.
 */
export function groupQuestion(wrapper: Element, first: Element, members: Element[]): string {
  const nearest = groupQuestionElement(wrapper, first, members);
  return nearest ? clip(nearest.textContent || "", MAX_TEXT_CHARS) : "";
}

/** The element groupQuestion reads. */
function groupQuestionElement(
  wrapper: Element,
  first: Element,
  members: Element[],
): Element | null {
  const memberSet = new Set(members);
  const titles = Array.from(wrapper.querySelectorAll(QUESTION_SELECTOR)).filter((el) => {
    if (!(first.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) return false;
    if (el.contains(first)) return false;
    const control = isA(el, HTMLLabelElement) ? el.control : null;
    // A title that is only a required mark names no question.
    return (
      !(control && memberSet.has(control)) && carriesWords(el.textContent || "") && isVisible(el)
    );
  });
  return titles.at(-1) ?? null;
}

export function groupMembers(control: Element): Element[] {
  const set = choiceSetGroup(control);
  if (set)
    return Array.from(set.querySelectorAll(`input[type="${(control as HTMLInputElement).type}"]`));
  const key = choiceGroupKey(control);
  if (!key) return [control];
  const input = control as HTMLInputElement;
  const scope = input.form ?? (control.getRootNode() as Document | ShadowRoot);
  return Array.from(
    scope.querySelectorAll(`input[type="${input.type}"][name="${CSS.escape(input.name)}"]`),
  );
}

/**
 * The mark a page draws beside a question to say it must be answered: a lone asterisk
 * (or a look-alike) closing the question's text. Typography, not wording.
 */
const REQUIRED_MARK_END = /[*∗✱✲⁎＊﹡]\s*$/u;

/** Whether the words that ask a question end in the required mark. */
function endsWithRequiredMark(question: Element | null): boolean {
  return question != null && REQUIRED_MARK_END.test(question.textContent ?? "");
}

/** The elements that ask a control's (or a group's) question, whichever way the page ties them. */
function questionElementsOf(members: Element[]): Element[] {
  const first = members[0];
  if (!first) return [];
  const asking: (Element | null)[] = [forLabelElementOf(first)];
  if (isListOpener(first)) asking.push(hostLabelElementOf(first));
  if (members.length > 1 || choiceGroupKey(first)) {
    asking.push(groupQuestionElement(fieldWrapper(first), first, members));
    asking.push(questionElementBeforeGroup(members));
  }
  return asking.filter((element): element is Element => element != null);
}

/**
 * The page requires this control's answer: it says so in markup (required,
 * aria-required) or draws the required mark beside the question that asks it.
 */
export function isRequired(members: Element[]): boolean {
  return (
    members.some(
      (el) =>
        (el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true",
    ) || questionElementsOf(members).some(endsWithRequiredMark)
  );
}
