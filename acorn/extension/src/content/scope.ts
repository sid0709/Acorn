/**
 * What a click opened inside the page: an entry form the page asks for (an
 * education or work history item), a dialog, a section to complete. The run takes
 * a census of the page right before such a click. Afterwards the controls that
 * are new — elements the census never held, and for fields, more of them asking
 * something than before — make the scope, held by the part of the page that was
 * there before it (its anchor), or by the dialog the click opened. The run
 * finishes the scope before anything else (fill it, then save it), as a person
 * finishes the form they opened.
 *
 * Structural only: element identity, a field's own attributes, and the page's
 * headings. Node ids are renumbered on every read, so they never tell old from new.
 */

import { holdsChoiceState } from "./agents/button-roles";
import { forgetPlannedFillsSince } from "./agents/plan-fill-registry";
import { readControlValue } from "./agents/read-control-value";
import {
  ACORN_ID_ATTR,
  MAX_TEXT_CHARS,
  clip,
  fieldLabel,
  fieldWrapper,
  isRequired,
  isVisible,
  matchesSafe,
  normalize,
  queryDeep,
  sectionTitle,
} from "./form-dom";
import { FILLABLE_SELECTOR } from "./form-frame";

import type { OpenScope, ScopeState } from "../types";

/** What a scope's own controls can be: its save, its cancel, its close. */
const SCOPE_CONTROL_SELECTOR =
  'button, [role="button"], a[href], input[type="submit"], input[type="button"]';
/** A layer the click may open over the page, holding the scope by itself. */
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]';
/** Headings that name what the click opened. */
const SCOPE_TITLE_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"], legend';

interface Census {
  /** When the click was about to land: answers given since went into the scope. */
  at: number;
  /** Every element the page held. */
  elements: WeakSet<Element>;
  /** How many fields asked each thing (see fieldKey). */
  fieldKeys: Map<string, number>;
}

let census: Census | null = null;
/** What holds the scope: the part of the page around it, or its own dialog. Set once read. */
let holder: Element | null = null;
/** The scope's fields as it opened: the ones the run fills and then sees taken. */
let openedFields: Element[] = [];

/** What a field asks, by its own attributes and section: a field drawn again keeps its key. */
function fieldKey(el: Element): string {
  return [
    el.tagName.toLowerCase(),
    el.getAttribute("type") ?? "",
    el.getAttribute("name") ?? "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("placeholder") ?? "",
    normalize(sectionTitle(el)),
  ].join("|");
}

function countKeys(fields: Element[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const el of fields) {
    const key = fieldKey(el);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Remember the page as it is, right before a click that may open something inside it. */
export function takeCensus(): void {
  const elements = new WeakSet<Element>();
  for (const el of queryDeep(document, "*")) elements.add(el);
  census = {
    at: Date.now(),
    elements,
    fieldKeys: countKeys(queryDeep(document, FILLABLE_SELECTOR)),
  };
  holder = null;
  openedFields = [];
}

/**
 * Whether the click drew an element, judged against the page as it is now. A field
 * the page only drew again (the same question as many times as before) is no new
 * field; one asking something new, or one more of the same (a row added), is.
 */
function drawnTest(): (el: Element) => boolean {
  const keysNow = countKeys(queryDeep(document, FILLABLE_SELECTOR));
  return (el) => {
    if (!census || census.elements.has(el)) return false;
    if (!matchesSafe(el, FILLABLE_SELECTOR)) return true;
    const key = fieldKey(el);
    return (keysNow.get(key) ?? 0) > (census.fieldKeys.get(key) ?? 0);
  };
}

function isOld(el: Element): boolean {
  return census?.elements.has(el) === true;
}

/** A field a person sees and fills: not a widget's hidden mirror of it. */
function personFacing(el: Element): boolean {
  return isVisible(el) && !el.closest('[aria-hidden="true"]');
}

/** The nearest element the page held before the click that holds every one of `els`. */
function anchorOf(els: Element[]): Element | null {
  const [first] = els;
  if (!first) return null;
  let meet: Element | null = first.parentElement;
  while (meet && !els.every((el) => meet?.contains(el))) meet = meet.parentElement;
  while (meet && !isOld(meet)) meet = meet.parentElement;
  return meet;
}

/**
 * What holds what the click drew: the dialog it opened around all of them, else the
 * nearest part of the page that was there before. With `pageWide` false, a holder
 * that is the whole page is none: new controls scattered over it are no one scope.
 */
function holderOf(els: Element[], pageWide: boolean): Element | null {
  const dialogs = new Set(els.map((el) => el.closest(DIALOG_SELECTOR)));
  const [dialog] = dialogs;
  if (dialogs.size === 1 && dialog && !isOld(dialog)) return dialog;
  const meet = anchorOf(els);
  if (pageWide) return meet;
  return meet && meet !== document.body && meet !== document.documentElement ? meet : null;
}

/** The heading of what the click opened, else the section its first field sits in. */
function titleOf(root: Element, fields: Element[]): string {
  const heading = Array.from(root.querySelectorAll(SCOPE_TITLE_SELECTOR)).find(
    (el) => !isOld(el) && isVisible(el),
  );
  // A dialog the click opened names itself; a part of the page held before names something else.
  const named =
    (!isOld(root) && root.getAttribute("aria-label")) ||
    heading?.textContent ||
    (fields[0] ? sectionTitle(fields[0]) : "");
  return clip(named || "", MAX_TEXT_CHARS);
}

function nodeIdOf(el: Element): number {
  return Number(el.getAttribute(ACORN_ID_ATTR)) || 0;
}

/**
 * What the last opening click drew, read right after a serialize so its controls
 * carry this read's node ids. Null when no census was taken or nothing new shows.
 */
export function readScope(): OpenScope | null {
  if (!census) return null;
  const drawn = drawnTest();
  const fields = queryDeep(document, FILLABLE_SELECTOR).filter(
    (el) => drawn(el) && personFacing(el),
  );
  // An option that holds a chosen state (a pill, a drawn radio) answers; it never saves.
  const newControls = queryDeep(document, SCOPE_CONTROL_SELECTOR).filter(
    (el) => drawn(el) && isVisible(el) && !holdsChoiceState(el),
  );
  const found = fields.length ? holderOf(fields, true) : holderOf(newControls, false);
  if (!found) return null;
  const controls = newControls.filter((el) => found.contains(el));
  if (!fields.length && !controls.length) return null;
  holder = found;
  openedFields = fields;
  return {
    controlIds: controls.map(nodeIdOf).filter((id) => id > 0),
    fields: fields.length,
    title: titleOf(found, fields),
  };
}

/**
 * The open scope as a test on elements: drawn by the opening click, inside what
 * holds it. Null when no scope is open. Built once per pass over the page.
 */
export function scopeTest(): ((el: Element) => boolean) | null {
  if (!census || !holder) return null;
  const drawn = drawnTest();
  const root = holder;
  return (el) => root.contains(el) && drawn(el);
}

function flagged(el: Element): boolean {
  return el.getAttribute("aria-invalid") === "true" || matchesSafe(el, ":user-invalid");
}

function needsAnswer(el: Element): boolean {
  return flagged(el) || (isRequired([el]) && !readControlValue(el).trim());
}

/**
 * Where the scope stands. It is still open while its own fields show, or when the
 * page drew it again with fields it flags (a save it refused). Fresh fields with
 * nothing flagged are not this scope: a page that took the entry may open an empty
 * form for the next one.
 */
export function scopeState(): ScopeState {
  const inside = scopeTest();
  const showing = (el: Element) => el.isConnected && personFacing(el);
  const kept = openedFields.filter(showing);
  const opened = new Set(openedFields);
  const redrawn = inside
    ? queryDeep(document, FILLABLE_SELECTOR).filter(
        (el) => inside(el) && showing(el) && !opened.has(el),
      )
    : [];
  const refused = redrawn.filter(flagged);
  const open = kept.length > 0 || refused.length > 0;
  const fields = open ? [...kept, ...redrawn] : [];
  return {
    open,
    fields: fields.length,
    issues: fields
      .filter(needsAnswer)
      .map((el) => fieldLabel(el, [el], fieldWrapper(el)))
      .filter(Boolean),
  };
}

/**
 * The scope is done. Saved (`committed`): the answers given since the census went
 * into an entry the page took, so drift repair never puts them back into other
 * fields that share their names.
 */
export function endScope(committed: boolean): void {
  if (committed && census) forgetPlannedFillsSince(census.at);
  census = null;
  holder = null;
  openedFields = [];
}
