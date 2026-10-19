/**
 * The page side of the choice pass: the questions of a page that are a choice among options (a list the
 * page draws itself, a group of radio buttons, yes/no buttons, a group of checkboxes), read from the
 * page's own structure (roles, ARIA state, groups, labels), never from a site's markup or words. The
 * extension clicks the points this says; the page is never handed a value or an event.
 */

import type {
  ChoiceKind,
  ChoiceLocated,
  ChoiceOptions,
  ChoiceScan,
  ChoiceState,
  ChoiceWidget,
} from "../agent/prefill/messages";

/** The most widgets one scan reports, and the longest a question or an option reads. */
const MAX_WIDGETS = 40;
const QUESTION_MAX_CHARS = 200;
/** How many ancestors are looked through for the text that asks a question. */
const QUESTION_CLIMB = 4;

/** What the choice pass borrows from the bridge. */
export interface ChoiceHelpers {
  clean(text: string | null | undefined): string;
  shown(el: Element): boolean;
  everyElement(): Element[];
  optionLabel(input: HTMLInputElement): string;
  locate(el: Element): ChoiceLocated;
}

interface Target {
  kind: ChoiceKind;
  trigger?: Element;
  members: Element[];
  /** A list's options, as last read. */
  items: Element[];
  /** The options that were showing before the list was opened: a popup's options are the ones that are new. */
  before: Set<Element>;
}

/** What an option of a popup list is, by its role. */
const OPTION_SELECTOR = '[role="option"], [role="menuitem"], [role="menuitemradio"]';
/** The controls that hold a value; a field's wrapper is the largest box around it that holds no other. */
const CONTROL_SELECTOR = "input:not([type=hidden]), select, textarea";
/** How many levels above a box are looked through for the selected item the field shows beside it. */
const WRAPPER_CLIMB = 5;
/** The popups an element can open that are lists of choices. */
const LIST_POPUPS = new Set(["listbox", "grid", "tree"]);
/** Input types that are never a box that picks from a list. */
const NOT_LIST_INPUTS = new Set([
  "hidden",
  "checkbox",
  "radio",
  "file",
  "button",
  "submit",
  "password",
]);

/**
 * Whether an input is a box that picks from a list rather than a place text goes: a search box, or one that
 * declares a popup or a combobox. It is left to the choice pass, which opens it and reads its options.
 */
export function isListPicker(el: Element): boolean {
  if (!(el instanceof HTMLInputElement) || NOT_LIST_INPUTS.has(el.type)) return false;
  const popup = el.getAttribute("aria-haspopup");
  return (
    el.type === "search" ||
    el.getAttribute("enterkeyhint") === "search" ||
    ["combobox", "searchbox"].includes(el.getAttribute("role") ?? "") ||
    Boolean(el.getAttribute("aria-autocomplete")) ||
    Boolean(popup && LIST_POPUPS.has(popup))
  );
}

const CHECKED_ATTRIBUTES = ["aria-checked", "aria-pressed", "aria-selected"];

const isDisabled = (el: Element): boolean =>
  (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";

function ariaOn(el: Element): boolean {
  return CHECKED_ATTRIBUTES.some((name) => el.getAttribute(name) === "true");
}

function isChecked(el: Element): boolean {
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    return el.checked;
  }
  return ariaOn(el);
}

/** Builds the choice pass for a frame. */
export function createChoices(helpers: ChoiceHelpers): {
  scan(): ChoiceScan;
  locate(id: number, option?: number): ChoiceLocated;
  options(id: number): ChoiceOptions;
  state(id: number): ChoiceState;
} {
  const { clean, shown, everyElement, optionLabel } = helpers;
  const targets = new Map<number, Target>();
  let nextId = 1;

  const textOfIds = (el: Element, attribute: string): string =>
    (el.getAttribute(attribute) ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");

  /** The words that ask the question of a control or a group, from what the page ties to it. */
  function questionOf(el: Element): string {
    // What is tied to the control by the page: a label for it, what it is labelled by, a fieldset's legend. The
    // control's own aria-label comes after, because it often carries the current answer ("State Select One").
    let node: Element | null = el;
    for (let climb = 0; climb < QUESTION_CLIMB && node; climb += 1) {
      const text = clean(
        ((node as HTMLInputElement).labels?.[0]?.textContent ?? "") ||
          textOfIds(node, "aria-labelledby") ||
          (node.tagName === "FIELDSET" ? node.querySelector("legend")?.textContent : ""),
      );
      if (text) return text.slice(0, QUESTION_MAX_CHARS);
      node = node.parentElement;
    }
    const own = clean(el.getAttribute("aria-label"));
    if (own) return own.slice(0, QUESTION_MAX_CHARS);
    node = el;
    for (let climb = 0; climb < QUESTION_CLIMB && node; climb += 1) {
      const before = node.previousElementSibling;
      const text = before ? clean((before as HTMLElement).innerText || before.textContent) : "";
      if (text && text.length <= QUESTION_MAX_CHARS) return text;
      node = node.parentElement;
    }
    return "";
  }

  const visibleOptions = (): Element[] =>
    everyElement().filter((el) => el.matches(OPTION_SELECTOR) && shown(el));

  /** The box around an input that holds no other control: where the page shows what was selected in it. */
  function ownWrapper(input: Element): Element {
    let wrapper = input;
    for (let climb = 0; climb < WRAPPER_CLIMB; climb += 1) {
      const parent = wrapper.parentElement;
      if (!parent || parent.querySelectorAll(CONTROL_SELECTOR).length !== 1) break;
      wrapper = parent;
    }
    return wrapper;
  }

  /**
   * Whether a list already holds an answer: a button that carries a value, or a box that shows a selected item
   * (an option beside it). The prompt a list starts on ("Select One") is not an answer, and neither is an
   * option the page only highlights.
   */
  function isAnswered(trigger: Element): boolean {
    if (trigger instanceof HTMLButtonElement) return trigger.value.trim() !== "";
    if (trigger instanceof HTMLInputElement) {
      return Boolean(ownWrapper(trigger).querySelector(OPTION_SELECTOR));
    }
    return false;
  }

  /** Whether an option is the chosen one. aria-selected on the option the list highlights (its active one) is not. */
  function isChosenOption(el: Element): boolean {
    if (el.getAttribute("aria-checked") === "true" || el.querySelector("input:checked"))
      return true;
    if (el.getAttribute("aria-selected") !== "true") return false;
    const list = el.closest('[role="listbox"], [role="menu"]');
    return !(list && el.id && list.getAttribute("aria-activedescendant") === el.id);
  }

  const textOf = (el: Element): string =>
    clean((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.textContent);

  const memberText = (el: Element): string =>
    el instanceof HTMLInputElement
      ? optionLabel(el)
      : clean((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.textContent);

  function add(widgets: ChoiceWidget[], target: Target, question: string, options: string[]): void {
    const id = nextId;
    nextId += 1;
    targets.set(id, target);
    widgets.push({
      id,
      kind: target.kind,
      question,
      options,
      answered: target.trigger ? isAnswered(target.trigger) : target.members.some(isChecked),
    });
  }

  /** Lists made of members that each show whether they are chosen: radios, checkboxes, buttons that press. */
  function groups(widgets: ChoiceWidget[]): void {
    const radios = new Map<string, HTMLInputElement[]>();
    const boxes = new Map<Element, HTMLInputElement[]>();
    const pressed = new Map<Element, Element[]>();
    for (const el of everyElement()) {
      if (el instanceof HTMLInputElement && el.type === "radio" && !el.disabled) {
        const key = `${el.form ? "form" : "page"}|${el.name}`;
        radios.set(key, [...(radios.get(key) ?? []), el]);
      } else if (el instanceof HTMLInputElement && el.type === "checkbox" && !el.disabled) {
        const group = el.closest('fieldset, [role="group"], [role="radiogroup"]');
        if (group) boxes.set(group, [...(boxes.get(group) ?? []), el]);
      } else if (
        (el.getAttribute("role") === "radio" ||
          el.hasAttribute("aria-pressed") ||
          (el.tagName === "BUTTON" && el.hasAttribute("aria-checked"))) &&
        !isDisabled(el)
      ) {
        const group = el.closest('[role="radiogroup"], [role="group"]') ?? el.parentElement;
        if (group) pressed.set(group, [...(pressed.get(group) ?? []), el]);
      }
    }
    const visible = (members: Element[]): Element[] =>
      members.filter(
        (m) => shown(m) || (m instanceof HTMLInputElement && m.labels?.[0] && shown(m.labels[0])),
      );
    for (const [key, members] of radios) {
      const own = visible(members);
      if (key.endsWith("|") || own.length < 2) continue;
      add(
        widgets,
        { kind: "group", members: own, items: [], before: new Set() },
        questionOf(own[0].closest("fieldset") ?? own[0]),
        own.map(memberText),
      );
    }
    for (const [group, members] of pressed) {
      const own = visible(members);
      if (own.length < 2) continue;
      add(
        widgets,
        { kind: "group", members: own, items: [], before: new Set() },
        questionOf(group),
        own.map(memberText),
      );
    }
    for (const [group, members] of boxes) {
      const own = visible(members);
      if (own.length < 2) continue;
      add(
        widgets,
        { kind: "boxes", members: own, items: [], before: new Set() },
        questionOf(group),
        own.map(memberText),
      );
    }
  }

  /** Whether an element names the popup it opens (aria-controls or aria-owns) and that popup is a list. */
  function controlsList(el: Element): boolean {
    return ["aria-controls", "aria-owns"].some((name) =>
      (el.getAttribute(name) ?? "").split(/\s+/).some((id) => {
        const target = id ? el.ownerDocument.getElementById(id) : null;
        return ["listbox", "menu", "tree", "grid"].includes(target?.getAttribute("role") ?? "");
      }),
    );
  }

  /** Lists the page draws itself: a button or box that opens a list. A text box that is typed into is not one. */
  function dropdowns(widgets: ChoiceWidget[]): void {
    const found = new Set<Element>();
    for (const el of everyElement()) {
      const popup = el.getAttribute("aria-haspopup");
      const picker = isListPicker(el);
      // A popup that is a list of choices (listbox, grid, tree), not a menu of actions (menu, or true, which
      // means a menu) and not a dialog: the page's own navigation menu is not a question.
      const opens =
        picker ||
        (popup !== null && LIST_POPUPS.has(popup)) ||
        el.getAttribute("role") === "combobox" ||
        (el.hasAttribute("aria-expanded") && controlsList(el));
      if (!opens || found.has(el) || isDisabled(el)) continue;
      // A text box is a list only when it declares itself a search or a popup (isListPicker).
      if (
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && !picker)
      )
        continue;
      if (
        el instanceof HTMLAnchorElement ||
        el.getAttribute("aria-expanded") === "true" ||
        !shown(el)
      )
        continue;
      // One control drawn as a box with a button inside it is one list, not two.
      if ([...found].some((other) => other.contains(el) || el.contains(other))) continue;
      found.add(el);
    }
    for (const trigger of found) {
      add(
        widgets,
        { kind: "dropdown", trigger, members: [], items: [], before: new Set() },
        questionOf(trigger),
        [],
      );
    }
  }

  return {
    scan(): ChoiceScan {
      try {
        targets.clear();
        nextId = 1;
        const widgets: ChoiceWidget[] = [];
        groups(widgets);
        dropdowns(widgets);
        return { ok: true, widgets: widgets.slice(0, MAX_WIDGETS) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    locate(id, option): ChoiceLocated {
      const target = targets.get(id);
      if (!target) return { ok: false, error: "the page no longer has this choice" };
      const el =
        option === undefined
          ? target.trigger
          : target.kind === "dropdown"
            ? target.items[option]
            : target.members[option];
      if (!el?.isConnected) return { ok: false, error: "the page no longer has this option" };
      // About to open the list: what shows now is not the popup's.
      if (option === undefined && target.kind === "dropdown") {
        target.before = new Set(visibleOptions());
        target.items = [];
      }
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      return helpers.locate(el);
    },

    options(id): ChoiceOptions {
      const target = targets.get(id);
      const trigger = target?.trigger;
      if (!target || !trigger) return { ok: false, error: "the page no longer has this list" };
      // The popup's options are the ones that were not showing before it opened, and not the ones read at the
      // level before (a list that drills in replaces its options with those of the item that was pressed).
      const known = new Set([...target.before, ...target.items]);
      let fresh = visibleOptions().filter((el) => !known.has(el));
      if (fresh.length === 0) {
        // A list of plain items that the control names (aria-controls, aria-owns).
        fresh = ["aria-controls", "aria-owns"]
          .flatMap((name) => (trigger.getAttribute(name) ?? "").split(/\s+/))
          .map((ref) => (ref ? trigger.ownerDocument.getElementById(ref) : null))
          .flatMap((list) => (list && shown(list) ? Array.from(list.querySelectorAll("li")) : []))
          .filter((el) => shown(el) && !known.has(el));
      }
      const prompt = isAnswered(trigger) ? "" : textOf(trigger);
      const items: Element[] = [];
      const texts: string[] = [];
      for (const el of fresh) {
        const text = textOf(el);
        if (!text || texts.includes(text) || (prompt && text === prompt)) continue;
        items.push(el);
        texts.push(text);
      }
      if (items.length < 2) return { ok: false, error: "the list shows no options" };
      target.items = items;
      return { ok: true, options: texts, selected: items.findIndex(isChosenOption) };
    },

    state(id): ChoiceState {
      const target = targets.get(id);
      if (!target) return { ok: false, error: "the page no longer has this choice" };
      const trigger = target.trigger;
      const chosen = target.members.flatMap((m, i) => (isChecked(m) ? [i] : []));
      return {
        ok: true,
        chosen,
        answered: trigger ? isAnswered(trigger) : chosen.length > 0,
        text: trigger
          ? clean(
              (trigger as HTMLElement).innerText ||
                trigger.getAttribute("value") ||
                trigger.textContent,
            )
          : "",
      };
    },
  };
}
