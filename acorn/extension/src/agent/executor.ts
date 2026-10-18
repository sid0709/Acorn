/**
 * Performs the agent's actions on the page. Each is something a person does: move the
 * pointer and click, type, press keys, scroll, hand the page a file. The executor knows
 * nothing about forms; it does what it is told and says what happened.
 */

import {
  ACTION_KIND,
  ACTION_OPENED,
  type ActionKind,
  type ActionOpened,
  type AgentAction,
  type AgentActionResult,
} from "@acorn/shared/agent-contract";

import { NO_FOCUS_MESSAGE, nothingHasFocus, scrollsAPage } from "./focus-guard";
import { blockedMessage, type GuardVerdict } from "./guard";
import { clickAt, moveMouse, pressKeys, typeText, wheelAt } from "./input";
import { watchInputEffects } from "./input-settle";
import {
  centerEdgeTarget,
  focusControlAt,
  hasState,
  readPointInfo,
  restoreScroll,
  type PointInfo,
} from "./point-info";
import { scrollForAction } from "./survey";
import { uploadAt, type ResumeFile } from "./upload";
import { waitForUploadProcessing } from "./upload-settle";

import type { Cdp } from "./cdp";
import type { Overlay } from "./overlay";

/** The pause after an action that changes the page, so what it did has drawn before the next look. */
export const SETTLE_MS = 350;
/**
 * A click within this fraction of the window's height of its top or bottom edge is made after scrolling
 * the control to the middle, and the page is then put back. Clicks that close to an edge did nothing
 * on a page where the same click at mid-screen worked, and nothing in the page said why (four sightings
 * in Workday runs), so the cause is unverified; a click away from the edges is made as it was.
 */
export const EDGE_BAND_RATIO = 0.08;
/** The pause after a scroll, which a page may answer by loading more. */
export const SCROLL_SETTLE_MS = 500;

/** What the executor needs from the run. */
export interface ExecutorContext {
  cdp: Cdp;
  overlay: Overlay;
  /** Screenshot pixels per CSS pixel of the latest shot. */
  scale(): number;
  /** The résumé file for an id the server chose. */
  resume(id: string, fileName: string): Promise<ResumeFile>;
  /** Waits; rejects when the person presses Stop. */
  sleep(ms: number): Promise<void>;
  /** Throws when the person pressed Stop. */
  checkStopped(): void;
  /**
   * Judges the control at a point (CSS pixels) before it is clicked: a file only ever comes from
   * this computer, never an online source. It starts while the cursor glides, so it adds no wait.
   */
  guard?: (x: number, y: number) => Promise<GuardVerdict>;
  /** Runs after a click has settled: it closes a frame or window the click opened that is an online file source. */
  afterClick?: () => Promise<void>;
  /**
   * Told what was under the pointer before a click and after it, when the control there has a state a
   * click can change (a box, a list, an expander): for the run's log, so a click that changed nothing
   * can be explained. It never blocks or changes the click.
   */
  inspected?: (at: { x: number; y: number }, before: PointInfo, after: PointInfo | null) => void;
  /**
   * Told when text was about to be typed and nothing had focus: where the last click was, what was
   * under it, and whether focusing the control there put the focus right. For the run's log.
   */
  noFocus?: (
    at: { x: number; y: number } | null,
    info: PointInfo | null,
    refocused: boolean,
  ) => void;
  /** How long an upload waits for the click to open a file picker; the default when unset. */
  fileChooserWaitMs?: number;
}

/**
 * The actions that can make a site send something (a code, a link) or move its page: a click,
 * typing, a key, a file. A wait or a scroll cannot, so they say nothing about when a site was asked.
 */
export const CHANGES_THE_PAGE: ReadonlySet<ActionKind> = new Set([
  ACTION_KIND.click,
  ACTION_KIND.doubleClick,
  ACTION_KIND.tripleClick,
  ACTION_KIND.rightClick,
  ACTION_KIND.type,
  ACTION_KIND.key,
  ACTION_KIND.upload,
]);

function point(action: AgentAction, scale: number): { x: number; y: number } {
  if (action.x == null || action.y == null) throw new Error("the action has no point");
  return { x: action.x / scale, y: action.y / scale };
}

/** Glides the visible cursor to the point and waits for it to arrive, so a person can follow. */
async function glideTo(ctx: ExecutorContext, x: number, y: number): Promise<void> {
  await ctx.overlay.moveTo(x, y);
}

/** Throws, so the click never happens, when the guard says the control is an online file source. */
async function refuseIfBlocked(verdict: Promise<GuardVerdict> | undefined): Promise<void> {
  const answer = await verdict;
  if (answer?.blocked) throw new Error(blockedMessage(answer.cause));
}

type Done = { detail?: string; opened?: ActionOpened };

/** Where each executor last clicked: typing goes to the control that click was meant for. */
const lastClicks = new WeakMap<object, { x: number; y: number }>();

/**
 * Clicks, and says whether the click opened a file picker. The session intercepts pickers so no
 * system dialog appears, which also hides them from a screenshot: without this the model would
 * see a click that did nothing, and could not tell it from one that missed.
 */
async function clickWatchingForPicker(
  ctx: ExecutorContext,
  x: number,
  y: number,
  options: Parameters<typeof clickAt>[3],
): Promise<Done> {
  let opened = false;
  const stop = ctx.cdp.onEvent((method) => {
    if (method === "Page.fileChooserOpened") opened = true;
  });
  lastClicks.set(ctx, { x, y });
  // Near an edge the control is brought to mid-screen for the click (and the page put back after it).
  const edge = await centerEdgeTarget(ctx.cdp, x, y, EDGE_BAND_RATIO);
  const at = edge ?? { x, y };
  const before = ctx.inspected ? await readPointInfo(ctx.cdp, at.x, at.y) : null;
  try {
    await clickAt(ctx.cdp, at.x, at.y, options);
    await ctx.sleep(SETTLE_MS);
    await ctx.afterClick?.();
    if (before && hasState(before)) {
      const after = await readPointInfo(ctx.cdp, at.x, at.y);
      ctx.inspected?.({ x: at.x, y: at.y }, before, after);
    }
  } finally {
    stop();
    if (edge) await restoreScroll(ctx.cdp, edge.scrollX, edge.scrollY);
  }
  return opened ? { opened: ACTION_OPENED.filePicker } : {};
}

async function perform(ctx: ExecutorContext, action: AgentAction): Promise<Done> {
  const { cdp } = ctx;
  switch (action.kind) {
    case "click":
    case "double_click":
    case "triple_click":
    case "right_click": {
      const { x, y } = point(action, ctx.scale());
      await scrollForAction(cdp, action, ctx.scale(), ctx.sleep);
      const verdict = ctx.guard?.(x, y);
      await glideTo(ctx, x, y);
      await refuseIfBlocked(verdict);
      void ctx.overlay.click();
      const count = action.kind === "double_click" ? 2 : action.kind === "triple_click" ? 3 : 1;
      return clickWatchingForPicker(ctx, x, y, {
        button: action.kind === "right_click" ? "right" : "left",
        count,
      });
    }
    case "hover": {
      const { x, y } = point(action, ctx.scale());
      await scrollForAction(cdp, action, ctx.scale(), ctx.sleep);
      await glideTo(ctx, x, y);
      void ctx.overlay.hover(true);
      await moveMouse(cdp, x, y);
      await ctx.sleep(SETTLE_MS);
      return {};
    }
    case "type": {
      if (!action.text) throw new Error("there is no text to type");
      if (await nothingHasFocus(cdp)) {
        // The click did not put focus in the control (something took it, or the page moved the focus
        // away): the control at that point is focused, as a person would tab to it, and the text is
        // typed with the same real keys. Without a control there, the text is refused as before.
        const at = lastClicks.get(ctx) ?? null;
        const refocused = at ? await focusControlAt(cdp, at.x, at.y) : false;
        ctx.noFocus?.(at, at ? await readPointInfo(cdp, at.x, at.y) : null, refocused);
        if (!refocused) throw new Error(NO_FOCUS_MESSAGE);
      }
      await typeText(cdp, action.text);
      await ctx.sleep(SETTLE_MS / 2);
      return { detail: `${[...action.text].length} characters` };
    }
    case "key": {
      if (!action.keys) throw new Error("there is no key to press");
      if (scrollsAPage(action.keys) && (await nothingHasFocus(cdp)))
        throw new Error(NO_FOCUS_MESSAGE);
      await pressKeys(cdp, action.keys);
      await ctx.sleep(SETTLE_MS);
      return {};
    }
    case "scroll": {
      const { x, y } = point(action, ctx.scale());
      const scale = ctx.scale();
      await glideTo(ctx, x, y);
      await wheelAt(cdp, x, y, (action.dx ?? 0) / scale, (action.dy ?? 0) / scale);
      await ctx.sleep(SCROLL_SETTLE_MS);
      return {};
    }
    case "upload": {
      const { x, y } = point(action, ctx.scale());
      if (!action.resume) throw new Error("the server named no résumé to upload");
      const file = await ctx.resume(action.resume, action.fileName ?? action.resume);
      await scrollForAction(cdp, action, ctx.scale(), ctx.sleep);
      const verdict = ctx.guard?.(x, y);
      await glideTo(ctx, x, y);
      await refuseIfBlocked(verdict);
      void ctx.overlay.click();
      const done = await uploadAt(cdp, x, y, file, ctx.fileChooserWaitMs);
      await waitForUploadProcessing(cdp, ctx.sleep);
      await ctx.sleep(SETTLE_MS);
      return { detail: `${done.fileName}, ${done.bytes} bytes, through the ${done.via}` };
    }
    case "wait": {
      await ctx.sleep(action.ms ?? 1000);
      return {};
    }
    default:
      throw new Error(`the extension cannot perform "${String(action.kind)}"`);
  }
}

/**
 * Runs the actions in order. One that fails stops the batch: what came after it was
 * planned for a page the failed action did not leave behind, so it is reported as skipped
 * and the agent looks at the page again.
 */
export async function runActions(
  ctx: ExecutorContext,
  actions: AgentAction[],
  options: { settle?: boolean } = {},
): Promise<AgentActionResult[]> {
  const results: AgentActionResult[] = [];
  let failed = false;
  // A step that types is looked at only once the page has answered what the typing asked of it. A
  // caller that runs many small batches in a row (the quick text pass) waits once, at the end.
  const typing = actions.some((action) => action.kind === "type" || action.kind === "key");
  const effects = typing && options.settle !== false ? await watchInputEffects(ctx.cdp) : null;
  for (const action of actions) {
    if (failed) {
      results.push({
        id: action.id,
        ok: false,
        error: "skipped: an earlier action in this step failed",
      });
      continue;
    }
    ctx.checkStopped();
    try {
      const done = await perform(ctx, action);
      results.push({
        id: action.id,
        ok: true,
        ...(done.detail ? { detail: done.detail } : {}),
        ...(done.opened ? { opened: done.opened } : {}),
      });
    } catch (err) {
      ctx.checkStopped();
      failed = true;
      results.push({
        id: action.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await effects?.settle(ctx.sleep);
  return results;
}
