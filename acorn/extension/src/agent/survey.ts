/**
 * A survey: the whole page as screenshots from top to bottom, taken by the extension on its own.
 * A model that sees one screen at a time spends a call on every scroll; given the whole page it
 * plans the form in one answer, naming the screen each point is measured on. The extension then
 * scrolls to that screen before each action (`scrollForAction`), and refuses when the page is not
 * where, or the shape, the survey saw: a form that grew a message above the field would move every
 * point below it.
 */

import { captureShot, type Shot } from "./capture";

import type { Cdp } from "./cdp";
import type { AgentAction, AgentSurveyScreen } from "@acorn/shared/agent-contract";

/** The most screens one survey takes; a longer page is surveyed down to here. */
export const SURVEY_MAX_SCREENS = 8;
/** How much of a screen the next one repeats, so a field on the seam is whole in one of them. */
export const SURVEY_OVERLAP = 0.15;
/** The pause after scrolling, for what the page draws or loads at the new place. */
export const SURVEY_SETTLE_MS = 120;
/** A page this many times taller than its window is worth a survey; a shorter one is one screen. */
export const SURVEY_MIN_PAGE_RATIO = 1.25;
/** How much taller or shorter than the survey saw it the page may be and still be acted on. */
export const LAYOUT_TOLERANCE_PX = 12;
/** How far from where it was asked to be the page may land (a page may snap or clamp). */
export const SCROLL_TOLERANCE_PX = 3;

type Layout = {
  cssVisualViewport: { pageY: number };
  cssContentSize: { height: number };
};

/** What the page is doing now: where it is scrolled, and how tall it is (CSS pixels). */
async function pageState(cdp: Cdp): Promise<{ y: number; height: number }> {
  const metrics = await cdp.send<Layout>("Page.getLayoutMetrics");
  return { y: metrics.cssVisualViewport.pageY, height: metrics.cssContentSize.height };
}

/** Scrolls the page to a place at once (no smooth scrolling) and says where it landed. */
export async function scrollPageTo(cdp: Cdp, y: number): Promise<{ y: number; height: number }> {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => { window.scrollTo({ top: ${Number(y)}, left: window.scrollX, behavior: "instant" }); })()`,
  });
  return pageState(cdp);
}

/**
 * The positions (CSS pixels) a survey of a page scrolls to: the top, then one screen less an
 * overlap at a time, and the very bottom. At most SURVEY_MAX_SCREENS of them.
 */
export function surveyPositions(pageHeight: number, viewHeight: number): number[] {
  if (!(viewHeight > 0) || pageHeight < viewHeight * SURVEY_MIN_PAGE_RATIO) return [];
  const last = pageHeight - viewHeight;
  const step = viewHeight * (1 - SURVEY_OVERLAP);
  const positions: number[] = [];
  for (let y = 0; y < last - 1; y += step) positions.push(Math.round(y));
  positions.push(Math.round(last));
  return positions.slice(0, SURVEY_MAX_SCREENS);
}

export interface SurveyDeps {
  cdp: Cdp;
  sleep: (ms: number) => Promise<void>;
  checkStopped: () => void;
}

/**
 * Scrolls through the page taking a screenshot at each position, then puts the page back where it
 * was. `first` is the look just taken: the screen at its own position is reused, not shot again.
 * Returns null when the page is about one screen tall. The caller hides the overlay around it.
 */
export async function captureSurvey(
  deps: SurveyDeps,
  first: Shot,
): Promise<AgentSurveyScreen[] | null> {
  const scale = first.scale;
  const positions = surveyPositions(
    first.viewport.pageHeight / scale,
    first.viewport.height / scale,
  );
  if (positions.length < 2) return null;
  const original = first.viewport.scrollY / scale;
  const screens: AgentSurveyScreen[] = [];
  try {
    for (const y of positions) {
      deps.checkStopped();
      if (Math.abs(y - original) < 1) {
        screens.push({ screenshot: first.dataUrl, scrollY: first.viewport.scrollY });
        continue;
      }
      await scrollPageTo(deps.cdp, y);
      await deps.sleep(SURVEY_SETTLE_MS);
      const shot = await captureShot(deps.cdp);
      screens.push({ screenshot: shot.dataUrl, scrollY: shot.viewport.scrollY });
    }
  } finally {
    await scrollPageTo(deps.cdp, original).catch(() => undefined);
  }
  // Two positions that landed on the same place (a short last step) are one screen.
  const seen = new Set<number>();
  const unique = screens.filter((screen) => {
    const key = Math.round(screen.scrollY);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length >= 2 ? unique : null;
}

/**
 * Before an action whose point was measured on a screen of a survey: scrolls there and checks
 * the page is where it was asked to be and the shape the survey saw. It throws otherwise, so the
 * action is not done at a point that now means something else; the model looks again.
 */
export async function scrollForAction(
  cdp: Cdp,
  action: AgentAction,
  scale: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  if (action.scrollTo == null) return;
  const wanted = action.scrollTo / scale;
  // A point pinned to the screenshot it was measured on (no page height) is only put back when the
  // page has moved: most actions find it where they left it, and cost no scroll and no wait.
  if (
    action.pageHeight == null &&
    Math.abs((await pageState(cdp)).y - wanted) <= SCROLL_TOLERANCE_PX
  ) {
    return;
  }
  const state = await scrollPageTo(cdp, wanted);
  await sleep(SURVEY_SETTLE_MS);
  if (action.pageHeight != null) {
    const saw = action.pageHeight / scale;
    if (Math.abs(state.height - saw) > LAYOUT_TOLERANCE_PX) {
      throw new Error(
        `the page changed shape since the survey (it was ${Math.round(saw)} px tall and is ${Math.round(state.height)} px): look again before acting`,
      );
    }
  }
  if (Math.abs(state.y - wanted) > SCROLL_TOLERANCE_PX) {
    throw new Error(
      `the page would not scroll to where the survey saw this (wanted ${Math.round(wanted)} px, got ${Math.round(state.y)} px): look again before acting`,
    );
  }
}
