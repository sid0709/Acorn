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

  /** The words that ask the question of a control or a group: what it is labelled by, then what is next to it. */
  function questionOf(el: Element): string {
    let node: Element | null = el;
    for (let climb = 0; climb < QUESTION_CLIMB && node; climb += 1) {
      const text = clean(
        textOfIds(node, "aria-labelledby") ||
          node.getAttribute("aria-label") ||
          (node.tagName === "FIELDSET" ? node.querySelector("legend")?.textContent : "") ||
          ((node as HTMLInputElement).labels?.[0]?.textContent ?? ""),
      );
      if (text) return text.slice(0, QUESTION_MAX_CHARS);
      node = node.parentElement;
    }
    node = el;
    for (let climb = 0; climb < QUESTION_CLIMB && node; climb += 1) {
      const before = node.previousElementSibling;
      const text = before ? clean((before as HTMLElement).innerText || before.textContent) : "";
      if (text && text.length <= QUESTION_MAX_CHARS) return text;
      node = node.parentElement;
    }
    return "";
  }

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
      answered: target.members.some(isChecked),
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
        { kind: "group", members: own, items: [] },
        questionOf(own[0].closest("fieldset") ?? own[0]),
        own.map(memberText),
      );
    }
    for (const [group, members] of pressed) {
      const own = visible(members);
      if (own.length < 2) continue;
      add(
        widgets,
        { kind: "group", members: own, items: [] },
        questionOf(group),
        own.map(memberText),
      );
    }
    for (const [group, members] of boxes) {
      const own = visible(members);
      if (own.length < 2) continue;
      add(
        widgets,
        { kind: "boxes", members: own, items: [] },
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
      const opens =
        (popup && popup !== "false" && popup !== "dialog") ||
        el.getAttribute("role") === "combobox" ||
        (el.hasAttribute("aria-expanded") && controlsList(el));
      if (!opens || found.has(el) || isDisabled(el)) continue;
      if (
        el instanceof HTMLSelectElement ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
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
      add(widgets, { kind: "dropdown", trigger, members: [], items: [] }, questionOf(trigger), []);
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
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      return helpers.locate(el);
    },

    options(id): ChoiceOptions {
      const target = targets.get(id);
      const trigger = target?.trigger;
      if (!target || !trigger) return { ok: false, error: "the page no longer has this list" };
      const controlled = ["aria-controls", "aria-owns"]
        .flatMap((name) => (trigger.getAttribute(name) ?? "").split(/\s+/))
        .map((ref) => (ref ? trigger.ownerDocument.getElementById(ref) : null))
        .filter((el): el is HTMLElement => Boolean(el) && shown(el as Element));
      const box = trigger.getBoundingClientRect();
      const distance = (el: Element): number => {
        const r = el.getBoundingClientRect();
        return Math.hypot(r.left - box.left, r.top - box.bottom);
      };
      const lists = controlled.length
        ? controlled
        : everyElement()
            .filter(
              (el) => ["listbox", "menu"].includes(el.getAttribute("role") ?? "") && shown(el),
            )
            .sort((a, b) => distance(a) - distance(b));
      const list = lists[0];
      if (!list) return { ok: false, error: "no list opened" };
      const items = Array.from(
        list.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li'),
      ).filter((el) => shown(el) && clean((el as HTMLElement).innerText || el.textContent));
      const texts = items.map((el) => clean((el as HTMLElement).innerText || el.textContent));
      const unique = items.filter((_, i) => texts.indexOf(texts[i]) === i);
      if (unique.length < 2) return { ok: false, error: "the list shows no options" };
      target.items = unique;
      return {
        ok: true,
        options: unique.map((el) => clean((el as HTMLElement).innerText || el.textContent)),
        selected: unique.findIndex(isChecked),
      };
    },

    state(id): ChoiceState {
      const target = targets.get(id);
      if (!target) return { ok: false, error: "the page no longer has this choice" };
      const trigger = target.trigger;
      return {
        ok: true,
        chosen: target.members.flatMap((m, i) => (isChecked(m) ? [i] : [])),
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
