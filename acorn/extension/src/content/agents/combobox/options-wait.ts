import { traceFromPage } from "../../../debug-trace";
import { isA } from "../../realm";
import { deepQueryAll } from "../../shadow-control";
import { waitMs } from "../wait";

import {
  collectOptionsInRoot,
  displayedListboxes,
  isDisplayed,
  normalize,
  optionSignature,
  optionText,
  ownedPopupOpen,
  pickScopedOptions,
} from "./options-dom";
import { newPopupRows, visibleElements } from "./popup-diff";
import { POPUP_SELECTOR } from "./popup-roles";
import { focusAndOpenCombobox } from "./typing";

const OPTION_WAIT_MS = 3000;
/**
 * How long one opening gesture (click, then ArrowDown) gets to show options before
 * the next is tried. Menus that render on open show options well within this; only
 * a menu that is still empty after both gestures gets the full OPTION_WAIT_MS.
 */
const OPEN_ATTEMPT_MS = 700;
/**
 * How long typing may show no popup at all before it is taken that none will come: a
 * suggestion box with nothing to suggest (an address search with no service behind it)
 * shows no list, and waiting out the full filter window for each word is seconds lost.
 */
const NO_POPUP_GIVE_UP_MS = 1500;

/** Wait until the visible list is no longer the pre-type snapshot, then settle. */
export async function waitForFilteredOptions(
  control: HTMLElement,
  doc: Document,
  previousSig: string,
  maxMs = OPTION_WAIT_MS,
): Promise<HTMLElement[]> {
  const started = Date.now();
  let lastSig = previousSig;
  let stableAt = Date.now();
  let last: HTMLElement[] = pickScopedOptions(control, doc);
  while (Date.now() - started < maxMs) {
    const options = pickScopedOptions(control, doc);
    if (
      !options.length &&
      Date.now() - started >= NO_POPUP_GIVE_UP_MS &&
      !popupShown(control, doc)
    ) {
      return [];
    }
    const sig = optionSignature(options);
    if (sig !== lastSig) {
      lastSig = sig;
      stableAt = Date.now();
      last = options;
    } else if (options.length && sig !== previousSig && Date.now() - stableAt >= 200) {
      return options;
    }
    await waitMs(50);
  }
  return last.length && optionSignature(last) !== previousSig
    ? last
    : pickScopedOptions(control, doc);
}

async function waitForStableOptions(
  control: HTMLElement,
  doc: Document,
  maxMs = OPTION_WAIT_MS,
): Promise<HTMLElement[]> {
  const started = Date.now();
  let lastSig = "";
  let stableAt = Date.now();
  let last: HTMLElement[] = [];
  while (Date.now() - started < maxMs) {
    const options = pickScopedOptions(control, doc);
    const sig = optionSignature(options);
    if (sig !== lastSig) {
      lastSig = sig;
      stableAt = Date.now();
      last = options;
    } else if (options.length && Date.now() - stableAt >= 200) {
      return options;
    }
    await waitMs(50);
  }
  return last.length ? last : pickScopedOptions(control, doc);
}

async function collectOptionsByScrolling(
  control: HTMLElement,
  doc: Document,
): Promise<HTMLElement[]> {
  const byKey = new Map<string, HTMLElement>();
  const add = (opts: HTMLElement[]) => {
    for (const opt of opts) {
      const key = normalize(optionText(opt));
      if (key && !byKey.has(key)) byKey.set(key, opt);
    }
  };

  add(pickScopedOptions(control, doc));
  const boxes = displayedListboxes(control, doc);
  const scrollTargets = new Set<HTMLElement>();
  for (const box of boxes) {
    if (box.scrollHeight > box.clientHeight + 8) scrollTargets.add(box);
    for (const child of Array.from(box.children)) {
      if (isA(child, HTMLElement) && child.scrollHeight > child.clientHeight + 8) {
        scrollTargets.add(child);
      }
    }
  }

  const targets = scrollTargets.size ? [...scrollTargets] : boxes;
  for (const box of targets) {
    const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
    if (maxScroll <= 0) {
      add(collectOptionsInRoot(box));
      continue;
    }
    const steps = 10;
    for (let i = 0; i <= steps; i += 1) {
      box.scrollTop = (maxScroll * i) / steps;
      await waitMs(40);
      add(collectOptionsInRoot(box));
      add(pickScopedOptions(control, doc));
    }
    box.scrollTop = 0;
  }
  return Array.from(byKey.values());
}

export async function findLiveOption(
  control: HTMLElement,
  doc: Document,
  label: string,
): Promise<HTMLElement | null> {
  const want = normalize(label);
  const visible = pickScopedOptions(control, doc).find(
    (opt) => normalize(optionText(opt)) === want,
  );
  if (visible?.isConnected) return visible;

  const scrolled = await collectOptionsByScrolling(control, doc);
  const live = scrolled.find((opt) => opt.isConnected && normalize(optionText(opt)) === want);
  if (live) return live;

  const boxes = displayedListboxes(control, doc);
  for (const box of boxes) {
    const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
    const steps = 10;
    for (let i = 0; i <= steps; i += 1) {
      box.scrollTop = maxScroll ? (maxScroll * i) / steps : 0;
      await waitMs(40);
      const hit = collectOptionsInRoot(box).find(
        (opt) => opt.isConnected && normalize(optionText(opt)) === want,
      );
      if (hit) return hit;
    }
  }
  return null;
}

/** Whether anything that holds options (a list, a menu, a grid, a tree) is on screen after the control was opened. */
export function popupShown(control: HTMLElement, doc: Document): boolean {
  if (ownedPopupOpen(control)) return true;
  return deepQueryAll(doc, `${POPUP_SELECTOR}, [role="menu"]`).some(
    (node) => isA(node, HTMLElement) && isDisplayed(node),
  );
}

export async function openAndCollectOptions(
  html: HTMLElement,
  doc: Document,
): Promise<HTMLElement[]> {
  // What the page shows before the control is opened: a list drawn with no ARIA roles is
  // found afterwards as what is new (see popup-diff.ts).
  const before = visibleElements(doc);
  await focusAndOpenCombobox(html);
  let options = await waitForStableOptions(html, doc, OPEN_ATTEMPT_MS);
  if (!options.length) {
    html.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    options = await waitForStableOptions(html, doc, OPEN_ATTEMPT_MS);
  }
  if (!options.length) {
    const drawn = newPopupRows(html, before, doc);
    if (drawn.length) {
      traceFromPage("combo:popup-diff", () => ({
        count: drawn.length,
        sample: drawn.slice(0, 8).map(optionText),
      }));
      return drawn;
    }
  }
  if (!options.length && popupShown(html, doc)) {
    // Remote-search menus fill in slowly: one full wait before giving up. A control that
    // opened no popup at all after both gestures is no dropdown: nothing is waited for.
    options = await waitForStableOptions(html, doc, OPTION_WAIT_MS);
  }
  const scrolled = await collectOptionsByScrolling(html, doc);
  return scrolled.length >= options.length ? scrolled : options;
}
