/**
 * The page's fields for the fast planner: every control stamped by the last
 * serializeDom() pass, as a kind, a label, and — for choices — its options.
 * Structural only: native input types, ARIA roles, visibility, and each
 * control's own field wrapper. Custom dropdowns are left out (their options only
 * exist once opened); the runtime's leftover pass answers them.
 */

import { PASSWORD_INPUT_TYPE } from "@acorn/shared/secret-value";

import { holdsChoiceState, looksLikeAnswers } from "./agents/button-roles";
import {
  choiceOptionLabel,
  hasClickableBox,
  inputOptionLabel,
  isProxyControl,
} from "./agents/choice-group";
import { optionLabel, realOptions } from "./agents/native-select";
import { groupRoot } from "./agents/select-radio";
import { getDirectText } from "./dom-serializer";
import {
  ACORN_ID_ATTR,
  MAX_TEXT_CHARS,
  NAMED_GROUP_SELECTOR,
  carriesWords,
  choiceGroupKey,
  clip,
  fieldLabel,
  fieldWrapper,
  groupAccessibleName,
  groupMembers,
  groupQuestion,
  isRequired,
  questionBeforeGroup,
  isPersonFacing,
  normalize,
  queryDeep,
  sectionTitle,
  withPartGroup,
  wrapperTexts,
} from "./form-dom";
import { FILLABLE_SELECTOR } from "./form-frame";
import { isA } from "./realm";
import { labelCandidates } from "./verify/element-labels";
import { inferRole } from "./verify/element-role";

import type { FormField } from "@acorn/shared/form-fields";

const MAX_FORM_FIELDS = 150;
/** Texts after a text field kept as its notes (a counter, a format hint). */
const TEXT_FIELD_NOTES = 2;
/** Short texts beside a file input that describe what it takes. */
const FILE_HINT_TEXTS = 3;
/** Native input types a person types into. A password box takes the account password. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  PASSWORD_INPUT_TYPE,
  "email",
  "tel",
  "url",
  "number",
  "date",
  "month",
  "week",
  "time",
  "datetime-local",
  "search",
]);
/** A choice field of buttons holds this many short options (Yes/No, a scale). */
const BUTTON_OPTIONS_MIN = 2;
const BUTTON_OPTIONS_MAX = 6;
const BUTTON_LABEL_MAX_CHARS = 30;
/** Buttons that are options by ARIA, wherever they sit. */
const ARIA_CHOICE_SELECTOR = '[role="radio"], [aria-pressed]';
/** A single on/off control built without a native checkbox (ARIA). */
const ARIA_TOGGLE_SELECTOR = '[role="checkbox"], [role="switch"]';
export const BUTTON_SELECTOR = 'button, [role="button"], [role="radio"], [aria-pressed]';
/** Plain buttons that may be one question's answers: no native input or ARIA state behind them. */
const PLAIN_BUTTON_SELECTOR = 'button, [role="button"]';
/** How far above a set of option buttons its question text is looked for. */
const QUESTION_SCOPE_DEPTH = 3;

function nodeId(el: Element): number {
  return Number(el.getAttribute(ACORN_ID_ATTR)) || 0;
}

function attr(el: Element, name: string): string | undefined {
  return el.getAttribute(name)?.trim() || undefined;
}

/**
 * What names a text field and bounds its answer: native attributes, plus the
 * text the page shows after it inside its own wrapper ("0/300"), which is how
 * many forms state a limit they enforce without maxlength.
 */
function textAttrs(
  el: Element,
  label: string,
): Pick<FormField, "autocomplete" | "placeholder" | "name" | "identifier" | "maxLength" | "notes"> {
  const maxLength = isA(el, HTMLInputElement) || isA(el, HTMLTextAreaElement) ? el.maxLength : -1;
  const notes = wrapperTexts(
    el,
    fieldWrapper(el),
    Node.DOCUMENT_POSITION_FOLLOWING,
    new Set([normalize(label)]),
  ).slice(0, TEXT_FIELD_NOTES);
  return {
    autocomplete: attr(el, "autocomplete"),
    placeholder: attr(el, "placeholder"),
    name: attr(el, "name"),
    identifier: attr(el, "id"),
    maxLength: maxLength > 0 ? maxLength : undefined,
    notes: notes.length ? notes : undefined,
  };
}

/** Short visible option buttons in a field box. */
function optionButtons(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(BUTTON_SELECTOR)).filter(
    (el): el is HTMLElement =>
      isA(el, HTMLElement) &&
      // Only an explicit submit is a submit: a bare <button> defaults to type=submit.
      el.getAttribute("type")?.toLowerCase() !== "submit" &&
      hasClickableBox(el) &&
      nodeId(el) > 0 &&
      choiceOptionLabel(el).length > 0 &&
      choiceOptionLabel(el).length <= BUTTON_LABEL_MAX_CHARS,
  );
}

/**
 * Buttons that are one question's answers: each carries its chosen state (ARIA),
 * or they read as peers with words of their own. Anything else acts on the form
 * (adds, opens, saves, cancels, removes) and is never offered as an answer.
 */
function answerButtons(buttons: HTMLElement[]): boolean {
  return buttons.every(holdsChoiceState) || looksLikeAnswers(buttons);
}

function buttonsField(buttons: HTMLElement[], label: string, required: boolean): FormField | null {
  if (buttons.length < BUTTON_OPTIONS_MIN || buttons.length > BUTTON_OPTIONS_MAX || !label) {
    return null;
  }
  if (!answerButtons(buttons)) return null;
  return {
    elementIndex: nodeId(buttons[0]),
    kind: "buttons",
    label,
    required,
    options: buttons.map((button) => choiceOptionLabel(button)),
  };
}

/**
 * A lone checkbox's label often names only the box ("Yes", "I agree"); the
 * question it answers is the title of the group it sits in. Both are the field.
 */
function toggleLabel(control: Element, own: string): string {
  const group = control.closest(NAMED_GROUP_SELECTOR);
  const question =
    groupAccessibleName(control) || (group ? groupQuestion(group, control, [control]) : "");
  if (!question || normalize(own).includes(normalize(question))) return own;
  // The question is already clipped; keep the box's own words after it.
  return own ? `${question} — ${own}` : question;
}

/** A radio or checkbox group (or a hidden proxy box behind visible option buttons). */
function choiceField(control: HTMLInputElement): FormField | null {
  const members = groupMembers(control);
  const wrapper = fieldWrapper(control);
  const required = isRequired(members);
  const single = members.length === 1;
  // A lone box nobody can see, next to short option buttons, is a Yes/No widget:
  // the answer lives on the buttons, and the box only mirrors it. A box a person
  // can see is its own answer; buttons beside it (view the terms) are not.
  if (single && isProxyControl(control)) {
    const buttons = optionButtons(wrapper);
    const label =
      groupQuestion(wrapper, buttons[0] ?? control, [control]) ||
      clip(labelCandidates(control)[0] ?? "", MAX_TEXT_CHARS);
    const field = buttonsField(buttons, label, required);
    if (field) return field;
  }
  const label = fieldLabel(control, members, wrapper);
  if (control.type === "checkbox" && single) {
    return {
      elementIndex: nodeId(control),
      kind: "toggle",
      label: toggleLabel(control, label),
      required,
      group: choiceGroupKey(control) ?? undefined,
    };
  }
  const options = members.map((member) => inputOptionLabel(member)).filter(Boolean);
  if (options.length < 2) return null;
  return {
    elementIndex: nodeId(control),
    kind: control.type === "checkbox" ? "checkbox" : "radio",
    label,
    required,
    options,
    // The group's identity on the page (not its position): a step names it, so what
    // it acts on is checked to belong to this group and no other.
    group: choiceGroupKey(control) ?? undefined,
  };
}

function describeControl(control: Element, seenGroups: Set<string>): FormField | null {
  const required = isRequired([control]);
  const label = () => fieldLabel(control, [control], fieldWrapper(control));
  if (isA(control, HTMLSelectElement)) {
    if (control.multiple) return null;
    const options = realOptions(control).map(optionLabel).filter(Boolean);
    if (!options.length) return null;
    return {
      elementIndex: nodeId(control),
      kind: "select",
      label: withPartGroup(control, label()),
      required,
      options,
    };
  }
  if (isA(control, HTMLInputElement)) {
    const type = (control.type || "text").toLowerCase();
    if (type === "file") {
      // A file input's own label is usually its button ("Attach"); the field's
      // question ("Resume/CV") is the title before it.
      const wrapper = fieldWrapper(control);
      // The nearest words that ask for the document win over a heading further up the
      // section, which names the section and not this upload.
      const question =
        groupAccessibleName(control) ||
        questionBeforeGroup([control]) ||
        groupQuestion(wrapper, control, [control]) ||
        label();
      // The drop zone's own words ("Import Resume", "Drop your resume here") tell a
      // parse-to-autofill zone from the résumé field.
      // The words around the input say which document it takes ("Type or paste
      // résumé" beside one, "cover letter" beside another), even in a shut panel.
      const nearby = fileContextTexts(control, question);
      const described = [question, ...nearby].filter(Boolean).join(" — ");
      return {
        elementIndex: nodeId(control),
        kind: "file",
        label: described,
        required,
        accept: attr(control, "accept"),
      };
    }
    if (type === "radio" || type === "checkbox") {
      const key = choiceGroupKey(control);
      if (key) {
        if (seenGroups.has(key)) return null;
        seenGroups.add(key);
      }
      return choiceField(control);
    }
    // aria-hidden marks a control no person reads or fills (a widget's mirror input); a
    // field no person could see or reach is a trap for robots. Neither is filled.
    if (!isPersonFacing(control) || control.closest('[aria-hidden="true"]')) return null;
    if (inferRole(control) === "combobox" || !TEXT_INPUT_TYPES.has(type)) return null;
    const text = withPartGroup(control, label());
    return {
      elementIndex: nodeId(control),
      kind: "text",
      label: text,
      inputType: type,
      required,
      ...textAttrs(control, text),
    };
  }
  const role = inferRole(control);
  if (
    isA(control, HTMLTextAreaElement) ||
    (control as HTMLElement).isContentEditable ||
    role === "textbox"
  ) {
    // A text box marked aria-hidden is a widget's mirror (one that sizes a growing box), as above.
    if (!isPersonFacing(control) || control.closest('[aria-hidden="true"]')) return null;
    const text = label();
    return {
      elementIndex: nodeId(control),
      kind: "textarea",
      label: text,
      required,
      ...textAttrs(control, text),
    };
  }
  return null;
}

/** How many levels above a file input its surrounding words are looked for. */
const FILE_CONTEXT_DEPTH = 3;

/**
 * The words around a file input: the text of the panel it sits in, read a few
 * levels up, hidden or not and option text included. A file input's own label is
 * usually its button ("File", "Attach"), and the panel holding it is often shut
 * until opened, yet its words still name the document it takes.
 */
function fileContextTexts(control: Element, question: string): string[] {
  const seen = new Set([normalize(question)]);
  const texts: string[] = [];
  let scope: Element | null = control.parentElement;
  for (
    let depth = 0;
    scope && depth < FILE_CONTEXT_DEPTH && texts.length < FILE_HINT_TEXTS;
    depth += 1
  ) {
    // Nearest first: what sits just before the input names it, not what opens the section.
    const around = Array.from(scope.querySelectorAll("*"));
    const before = around.filter(
      (el) => control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING,
    );
    const after = around.filter(
      (el) => control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    for (const el of [...before.reverse(), ...after]) {
      if (el === control || el.contains(control)) continue;
      const text = getDirectText(el);
      if (!text || !carriesWords(text) || seen.has(normalize(text))) continue;
      seen.add(normalize(text));
      texts.push(clip(text, MAX_TEXT_CHARS));
      if (texts.length >= FILE_HINT_TEXTS) break;
    }
    scope = scope.parentElement;
  }
  return texts;
}

/** Option buttons marked by ARIA (role=radio / aria-pressed) with no native input behind them. */
function ariaButtonFields(claimed: Set<number>): FormField[] {
  const fields: FormField[] = [];
  const seenRoots = new Set<ParentNode>();
  for (const el of queryDeep(document, ARIA_CHOICE_SELECTOR)) {
    if (!isA(el, HTMLElement) || claimed.has(nodeId(el))) continue;
    const root = groupRoot(el);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    const buttons = optionButtons(root).filter((button) => button.matches(ARIA_CHOICE_SELECTOR));
    // The group's own name is the question; an option's label is only its answer.
    const label = groupAccessibleName(el) || clip(labelCandidates(el)[0] ?? "", MAX_TEXT_CHARS);
    const field = buttonsField(buttons, label, isRequired(buttons));
    // A group the native-input pass already listed (its first button) is not new.
    if (field && !claimed.has(field.elementIndex)) fields.push(field);
  }
  return fields;
}

/**
 * The text a person reads as the question right before a set of option buttons:
 * the nearest title, else the nearest text before the first button, looked for
 * from the buttons' own container outward. Empty when nothing precedes them.
 */
function questionBefore(root: Element, first: HTMLElement, buttons: HTMLElement[]): string {
  const titled = groupQuestion(fieldWrapper(first), first, buttons);
  if (titled) return titled;
  let scope: Element | null = root;
  for (let depth = 0; scope && depth < QUESTION_SCOPE_DEPTH; depth += 1) {
    const before = Array.from(scope.querySelectorAll("*")).filter(
      (el) =>
        Boolean(first.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) &&
        !el.contains(first) &&
        !buttons.some((button) => button.contains(el)) &&
        isPersonFacing(el),
    );
    for (const el of before.reverse()) {
      const text = getDirectText(el);
      if (text && carriesWords(text)) return clip(text, MAX_TEXT_CHARS);
    }
    scope = scope.parentElement;
  }
  return "";
}

/**
 * Option buttons with no native input and no ARIA state behind them (Yes / No
 * pills whose choice shows only in their styling): one question's answers when a
 * few short buttons share a container, a question precedes them, and they read as
 * peers. The buttons of an entry (edit, remove) or of a form's footer (cancel,
 * save) share containers too, but act on the form: they are no field.
 */
function plainButtonFields(claimed: Set<number>): FormField[] {
  const fields: FormField[] = [];
  const seenRoots = new Set<ParentNode>();
  for (const el of queryDeep(document, PLAIN_BUTTON_SELECTOR)) {
    if (!isA(el, HTMLElement) || nodeId(el) <= 0 || claimed.has(nodeId(el))) continue;
    if (el.matches(ARIA_CHOICE_SELECTOR) || !hasClickableBox(el)) continue;
    const root = groupRoot(el);
    if (seenRoots.has(root) || !isA(root, Element)) continue;
    seenRoots.add(root);
    const buttons = optionButtons(root);
    if (
      buttons.some((button) => claimed.has(nodeId(button)) || button.matches(ARIA_CHOICE_SELECTOR))
    ) {
      continue;
    }
    const label = questionBefore(root, buttons[0] ?? el, buttons);
    const field = buttonsField(buttons, label, isRequired(buttons));
    if (field) fields.push(withSection(field, el));
  }
  return fields;
}

/**
 * Checkboxes and switches built from ARIA roles rather than a native box (an
 * agreement, an opt-in). Skipped when a native checkbox stands behind them: that
 * box is already a field, and answering both would toggle it twice.
 */
function ariaToggleFields(claimed: Set<number>): FormField[] {
  const fields: FormField[] = [];
  for (const el of queryDeep(document, ARIA_TOGGLE_SELECTOR)) {
    if (!isA(el, HTMLElement) || claimed.has(nodeId(el)) || nodeId(el) <= 0) continue;
    if (!hasClickableBox(el) || el.closest('[aria-hidden="true"]')) continue;
    const native = 'input[type="checkbox"]';
    if (el.querySelector(native) || el.closest("label")?.querySelector(native)) continue;
    const own = clip(labelCandidates(el)[0] ?? "", MAX_TEXT_CHARS);
    const label = toggleLabel(el, own);
    if (!label) continue;
    fields.push(
      withSection(
        { elementIndex: nodeId(el), kind: "toggle", label, required: isRequired([el]) },
        el,
      ),
    );
  }
  return fields;
}

/** Every control a listed field already answers through: its own and its options'. */
function claimedBy(fields: FormField[]): Set<number> {
  return new Set(fields.map((field) => field.elementIndex));
}

/** The field plus its section heading, when that adds anything beyond the label. */
function withSection(field: FormField, control: Element): FormField {
  const section = sectionTitle(control);
  return section && section !== field.label ? { ...field, section } : field;
}

const TEXT_KINDS = new Set<FormField["kind"]>(["text", "textarea"]);

/** The question inside a control's own field wrapper: its title, else the nearest text before it. */
function wrapperQuestion(control: Element): string {
  const wrapper = fieldWrapper(control);
  return (
    groupQuestion(wrapper, control, [control]) ||
    wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_PRECEDING, new Set()).at(-1) ||
    ""
  );
}

/**
 * Text fields that came out with one shared label: the label points past them (an
 * id the page reuses, a name attribute) rather than naming each question, and the
 * planner would give every one of them the same answer. Each takes the question in
 * its own wrapper instead, when that tells them apart.
 */
function separateSharedLabels(rows: { field: FormField; control: Element }[]): void {
  const byLabel = new Map<string, { field: FormField; control: Element }[]>();
  for (const row of rows) {
    if (!TEXT_KINDS.has(row.field.kind)) continue;
    const key = normalize(row.field.label);
    byLabel.set(key, [...(byLabel.get(key) ?? []), row]);
  }
  for (const shared of byLabel.values()) {
    if (shared.length < 2) continue;
    const questions = shared.map((row) => wrapperQuestion(row.control));
    const distinct = new Set(questions.map(normalize));
    if (questions.some((question) => !question) || distinct.size !== shared.length) continue;
    shared.forEach((row, i) => {
      row.field.label = questions[i];
    });
  }
}

/** Every fillable field on the page, in page order. */
export function scanFormFields(): FormField[] {
  const seenGroups = new Set<string>();
  const rows: { field: FormField; control: Element }[] = [];
  for (const control of queryDeep(document, `:is(${FILLABLE_SELECTOR})[${ACORN_ID_ATTR}]`)) {
    const field = describeControl(control, seenGroups);
    if (field?.elementIndex) rows.push({ field: withSection(field, control), control });
  }
  separateSharedLabels(rows);
  const fields = rows.map((row) => row.field);
  const claimed = new Set(fields.map((field) => field.elementIndex));
  fields.push(...ariaButtonFields(claimed));
  fields.push(...ariaToggleFields(new Set(fields.map((field) => field.elementIndex))));
  fields.push(...plainButtonFields(claimedBy(fields)));
  return fields.slice(0, MAX_FORM_FIELDS);
}
