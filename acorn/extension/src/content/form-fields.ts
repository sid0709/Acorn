/**
 * The page's fields for the fast planner: every control stamped by the last
 * serializeDom() pass, as a kind, a label, and — for choices — its options.
 * Structural only: native input types, ARIA roles, visibility, and each
 * control's own field wrapper. Custom dropdowns are left out (their options only
 * exist once opened); the runtime's leftover pass answers them.
 */

import { PASSWORD_INPUT_TYPE } from "@acorn/shared/secret-value";

import { choiceOptionLabel, hasClickableBox, inputOptionLabel } from "./agents/choice-group";
import { optionLabel, realOptions } from "./agents/native-select";
import { groupRoot } from "./agents/select-radio";
import {
  ACORN_ID_ATTR,
  MAX_TEXT_CHARS,
  NAMED_GROUP_SELECTOR,
  choiceGroupKey,
  clip,
  fieldLabel,
  fieldWrapper,
  groupAccessibleName,
  groupMembers,
  groupQuestion,
  isRequired,
  isVisible,
  normalize,
  queryDeep,
  sectionTitle,
  wrapperTexts,
} from "./form-dom";
import { FILLABLE_SELECTOR } from "./form-frame";
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
): Pick<FormField, "autocomplete" | "placeholder" | "name" | "maxLength" | "notes"> {
  const maxLength =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.maxLength : -1;
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
    maxLength: maxLength > 0 ? maxLength : undefined,
    notes: notes.length ? notes : undefined,
  };
}

/** Short visible option buttons in a field box. */
function optionButtons(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(BUTTON_SELECTOR)).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      // Only an explicit submit is a submit: a bare <button> defaults to type=submit.
      el.getAttribute("type")?.toLowerCase() !== "submit" &&
      hasClickableBox(el) &&
      nodeId(el) > 0 &&
      choiceOptionLabel(el).length > 0 &&
      choiceOptionLabel(el).length <= BUTTON_LABEL_MAX_CHARS,
  );
}

function buttonsField(buttons: HTMLElement[], label: string, required: boolean): FormField | null {
  if (buttons.length < BUTTON_OPTIONS_MIN || buttons.length > BUTTON_OPTIONS_MAX || !label) {
    return null;
  }
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
  if (single) {
    // A lone box next to short option buttons is a Yes/No widget: the answer lives
    // on the buttons, and the box only mirrors it.
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
  };
}

function describeControl(control: Element, seenGroups: Set<string>): FormField | null {
  const required = isRequired([control]);
  const label = () => fieldLabel(control, [control], fieldWrapper(control));
  if (control instanceof HTMLSelectElement) {
    if (control.multiple) return null;
    const options = realOptions(control).map(optionLabel).filter(Boolean);
    if (!options.length) return null;
    return { elementIndex: nodeId(control), kind: "select", label: label(), required, options };
  }
  if (control instanceof HTMLInputElement) {
    const type = (control.type || "text").toLowerCase();
    if (type === "file") {
      // A file input's own label is usually its button ("Attach"); the field's
      // question ("Resume/CV") is the title before it.
      const wrapper = fieldWrapper(control);
      const question =
        groupAccessibleName(control) || groupQuestion(wrapper, control, [control]) || label();
      // The drop zone's own words ("Import Resume", "Drop your resume here") tell a
      // parse-to-autofill zone from the résumé field.
      const nearby = [
        ...wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_PRECEDING, new Set([question])),
        ...wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_FOLLOWING, new Set([question])),
      ].slice(0, FILE_HINT_TEXTS);
      const described = [question, ...nearby].filter(Boolean).join(" — ");
      return { elementIndex: nodeId(control), kind: "file", label: described, required };
    }
    if (type === "radio" || type === "checkbox") {
      const key = choiceGroupKey(control);
      if (key) {
        if (seenGroups.has(key)) return null;
        seenGroups.add(key);
      }
      return choiceField(control);
    }
    // aria-hidden marks a control no person reads or fills (a widget's mirror input).
    if (!isVisible(control) || control.closest('[aria-hidden="true"]')) return null;
    if (inferRole(control) === "combobox" || !TEXT_INPUT_TYPES.has(type)) return null;
    const text = label();
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
    control instanceof HTMLTextAreaElement ||
    (control as HTMLElement).isContentEditable ||
    role === "textbox"
  ) {
    if (!isVisible(control)) return null;
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

/** Option buttons marked by ARIA (role=radio / aria-pressed) with no native input behind them. */
function ariaButtonFields(claimed: Set<number>): FormField[] {
  const fields: FormField[] = [];
  const seenRoots = new Set<ParentNode>();
  for (const el of queryDeep(document, ARIA_CHOICE_SELECTOR)) {
    if (!(el instanceof HTMLElement) || claimed.has(nodeId(el))) continue;
    const root = groupRoot(el);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    const buttons = optionButtons(root).filter((button) => button.matches(ARIA_CHOICE_SELECTOR));
    const label = clip(labelCandidates(el)[0] ?? "", MAX_TEXT_CHARS);
    const field = buttonsField(buttons, label, isRequired(buttons));
    // A group the native-input pass already listed (its first button) is not new.
    if (field && !claimed.has(field.elementIndex)) fields.push(field);
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
    if (!(el instanceof HTMLElement) || claimed.has(nodeId(el)) || nodeId(el) <= 0) continue;
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
  return fields.slice(0, MAX_FORM_FIELDS);
}
