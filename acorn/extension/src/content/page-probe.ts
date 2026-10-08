/**
 * A cheap look at the page while the run waits on a click: which fields it asks
 * for, where it is, and how many marks it shows that something is wrong. Nothing
 * is serialized and no node ids are touched, so it can run every poll.
 */

import { shortHash } from "@acorn/shared/page-controls";

import { isVisible, queryDeep } from "./form-dom";

import type { PageProbe } from "../types";

/** Inputs that are buttons or carry no answer, as the page signature leaves them out. */
const NON_FIELD_INPUTS = new Set(["hidden", "submit", "button", "image", "reset"]);
/** What a person clicks: counted so a page still rendering shows it is not done. */
const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="link"]';
/** Marks a page puts up when it refuses what was entered. */
const REFUSAL_SELECTOR = '[aria-invalid="true"], [role="alert"]';

export function probePage(): PageProbe {
  const fields: string[] = [];
  for (const el of queryDeep(document, "input, select, textarea")) {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (NON_FIELD_INPUTS.has(type)) continue;
    fields.push(
      [
        el.tagName.toLowerCase(),
        type,
        el.getAttribute("name"),
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
      ]
        .map((part) => part ?? "")
        .join(":"),
    );
  }
  const refusals = queryDeep(document, REFUSAL_SELECTOR).filter(
    (el) =>
      isVisible(el) &&
      Boolean((el as HTMLElement).innerText?.trim() || el.matches("[aria-invalid]")),
  ).length;
  return {
    url: location.href,
    fields: shortHash(fields.join("|")),
    refusals,
    controls: queryDeep(document, CONTROL_SELECTOR).length,
    textLength: document.body?.innerText.length ?? 0,
  };
}
