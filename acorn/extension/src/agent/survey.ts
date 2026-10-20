/**
 * A survey: the whole page as screenshots from top to bottom, taken by the extension on its own.
 * A model that sees one screen at a time spends a call on every scroll; given the whole page it
 * plans the form in one answer, naming the screen each point is measured on. The extension then
 * scrolls to that screen before each action (`scrollForAction`), and refuses when the page is not
 * where, or the shape, the survey saw: a form that grew a message above the field would move every
 * point below it.
 */

import { captureShot, type Shot } from "./capture";
import { SCROLL_TOLERANCE_PX, pageState, scrollPageSlowly } from "./page-scroll";

import type { Cdp } from "./cdp";
import type {
  AgentAction,
  AgentActionResult,
  AgentSurveyScreen,
  AgentZoneShot,
} from "@acorn/shared/agent-contract";

/** The most screens one survey takes; a longer page is surveyed down to here. */
export const SURVEY_MAX_SCREENS = 8;
/** How much of a screen the next one repeats, so a field on the seam is whole in one of them. */
export const SURVEY_OVERLAP = 0.15;
/** The pause after scrolling, for what the page draws or loads at the new place. */
export const SURVEY_SETTLE_MS = 350;
/** A page this many times taller than its window is worth a survey; a shorter one is one screen. */
export const SURVEY_MIN_PAGE_RATIO = 1.25;
/** How much taller or shorter than the survey saw it the page may be and still be acted on. */
export const LAYOUT_TOLERANCE_PX = 12;

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

/** What the last survey saw: its screens and how tall the page was (screenshot pixels). */
export interface SurveyMemory {
  screens: AgentSurveyScreen[];
  pageHeight: number;
}

/**
 * What a new survey may take from what the run already has instead of scrolling for it: the screens
 * of the last survey, and the photos taken when the zones of the plan just carried out were done.
 */
export interface SurveyReuse {
  previous: SurveyMemory | null;
  zones: AgentZoneShot[];
}

/** What a survey is: its screens, and how many of them were taken from what the run already had. */
export interface SurveyResult {
  screens: AgentSurveyScreen[];
  reused: number;
}

/**
 * Whether the batch just carried out leaves the last survey good for the parts it did not touch: every
 * action ran, every action belongs to a zone of a fast-fill plan (so each zone was photographed when it
 * was done), and none was an upload, which fills fields all over the page (a résumé read).
 */
export function isReusableBatch(actions: AgentAction[], results: AgentActionResult[]): boolean {
  return (
    actions.length > 0 &&
    results.every((result) => result.ok) &&
    actions.every((action) => action.zone != null && action.kind !== "upload")
  );
}

/**
 * Takes the screens of a page. A screen is reused, not scrolled for and shot again, when a photo of
 * its zone was taken when the zone was done (the freshest look at it), or the last survey has it and
 * nothing in the batch just done touched it; both only while the page is as tall as the last survey saw
 * it, since a page that grew may have moved what is below the growth. The rest are taken by scrolling
 * to them with the wheel, slowly, and waiting for the page to rest before the shot, and the page is
 * then put back where it was. When every screen is reused the page does not move at all.
 * `first` is the look just taken: the screen at its own position is never shot again. Returns null
 * when the page is about one screen tall. The caller hides the overlay around it.
 */
export async function captureSurvey(
  deps: SurveyDeps,
  first: Shot,
  reuse?: SurveyReuse,
): Promise<SurveyResult | null> {
  const scale = first.scale;
  const positions = surveyPositions(
    first.viewport.pageHeight / scale,
    first.viewport.height / scale,
  );
  if (positions.length < 2) return null;
  const original = first.viewport.scrollY / scale;
  const sameHeight =
    reuse?.previous != null &&
    Math.abs(reuse.previous.pageHeight - first.viewport.pageHeight) <= LAYOUT_TOLERANCE_PX * scale;
  const near = (a: number, b: number) => Math.abs(a - b) <= SCROLL_TOLERANCE_PX * scale;
  const screens: AgentSurveyScreen[] = [];
  let reused = 0;
  let scrolled = false;
  try {
    for (const y of positions) {
      deps.checkStopped();
      const at = y * scale;
      if (Math.abs(y - original) < 1) {
        screens.push({ screenshot: first.dataUrl, scrollY: first.viewport.scrollY });
        continue;
      }
      const have = sameHeight
        ? (reuse?.zones.find((zone) => near(zone.scrollY, at)) ??
          reuse?.previous?.screens.find((screen) => near(screen.scrollY, at)))
        : undefined;
      if (have) {
        screens.push({ screenshot: have.screenshot, scrollY: have.scrollY });
        reused += 1;
        continue;
      }
      scrolled = true;
      await scrollPageSlowly(deps.cdp, y, deps.sleep);
      await deps.sleep(SURVEY_SETTLE_MS);
      const shot = await captureShot(deps.cdp);
      screens.push({ screenshot: shot.dataUrl, scrollY: shot.viewport.scrollY });
    }
  } finally {
    if (scrolled) await scrollPageSlowly(deps.cdp, original, deps.sleep).catch(() => undefined);
  }
  // Two positions that landed on the same place (a short last step) are one screen.
  const seen = new Set<number>();
  const unique = screens.filter((screen) => {
    const key = Math.round(screen.scrollY);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length >= 2 ? { screens: unique, reused } : null;
}

/**
 * Takes the run's surveys and remembers what the last one saw, so the next takes again only what
 * changed (see `captureSurvey`). `noteBatch` says what the batch just carried out was, and the next
 * survey uses it once.
 */
export class SurveyKeeper {
  /** How many screens of the last survey were taken from what the run already had. */
  reused = 0;
  private memory: SurveyMemory | null = null;
  private reusable = false;

  noteBatch(actions: AgentAction[], results: AgentActionResult[]): void {
    this.reusable = isReusableBatch(actions, results);
  }

  async take(
    deps: SurveyDeps,
    first: Shot,
    zoneShots: AgentZoneShot[],
  ): Promise<AgentSurveyScreen[] | null> {
    const reuse =
      this.reusable && this.memory ? { previous: this.memory, zones: [...zoneShots] } : undefined;
    this.reusable = false;
    const taken = await captureSurvey(deps, first, reuse);
    this.reused = taken?.reused ?? 0;
    this.memory = taken ? { screens: taken.screens, pageHeight: first.viewport.pageHeight } : null;
    return taken?.screens ?? null;
  }
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
  const state = await scrollPageSlowly(cdp, wanted, sleep);
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
