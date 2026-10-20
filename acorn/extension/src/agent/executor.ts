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
import { type ScrollContext } from "./page-scroll";
import { scrollForAction, type PlaceMarks } from "./survey";
import { Stopwatch } from "./timing";
import { uploadAt, type ResumeFile } from "./upload";
import { waitForUploadProcessing } from "./upload-settle";

import type { Cdp } from "./cdp";
import type { Overlay } from "./overlay";

/** The pause after an action that changes the page, so what it did has drawn before the next look. */
export const SETTLE_MS = 350;
/** The pause after a scroll, which a page may answer by loading more. */
export const SCROLL_SETTLE_MS = 500;

/**
 * The least a click pauses where the page is waited on only until it goes quiet: a click may open a file
 * chooser, which the browser announces a moment after it, and the announcement is what says the click did.
 */
export const CLICK_SETTLE_FLOOR_MS = 150;

/**
 * Pauses after an action that changes the page: at most `ms`, and less where the run can tell the page has
 * settled, but not less than `floorMs` there.
 */
function settle(ctx: ExecutorContext, ms: number, floorMs?: number): Promise<void> {
  return ctx.settle ? ctx.settle(ms, floorMs) : ctx.sleep(ms);
}

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
  /** How long an upload waits for the click to open a file picker; the default when unset. */
  fileChooserWaitMs?: number;
  /** Called when the last action of a zone of a fast-fill plan is done: the run takes a photo of the page. */
  zoneDone?: (zone: number) => Promise<void>;
  /** The run's scrolling: the settled parts it keeps out of, and where it tells what it did. */
  scroll?: ScrollContext;
  /** Takes a picture of the page now and sends it to the agent for a `snap` action, which waits for it to arrive. */
  snap?: (action: AgentAction) => Promise<void>;
  /** Finds an action's target again on a page that changed shape: its point in screenshot pixels, or null. */
  locate?: (action: AgentAction) => Promise<{ x: number; y: number } | null>;
  /** Finds it again by the control the point was bound to when it was planned, which the page can say the place of. */
  marks?: PlaceMarks;
  /**
   * Pauses after an action that changes the page, for at most `ms` and not less than `floorMs` where it
   * pauses less: a run that can tell the page has gone quiet does, and one that cannot pauses `ms`, as it
   * always did.
   */
  settle?: (ms: number, floorMs?: number) => Promise<void>;
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
  watch: Stopwatch,
): Promise<Done> {
  let opened = false;
  const stop = ctx.cdp.onEvent((method) => {
    if (method === "Page.fileChooserOpened") opened = true;
  });
  try {
    await watch.time("click", () => clickAt(ctx.cdp, x, y, options));
    await watch.time("settle", () => settle(ctx, SETTLE_MS, CLICK_SETTLE_FLOOR_MS));
    await watch.time("afterClick", async () => ctx.afterClick?.());
  } finally {
    stop();
  }
  return opened ? { opened: ACTION_OPENED.filePicker } : {};
}

async function perform(ctx: ExecutorContext, action: AgentAction, watch: Stopwatch): Promise<Done> {
  const { cdp } = ctx;
  switch (action.kind) {
    case "click":
    case "double_click":
    case "triple_click":
    case "right_click": {
      const { x, y } = await watch.time("scroll", () =>
        scrollForAction(cdp, action, ctx.scale(), ctx),
      );
      const verdict = ctx.guard?.(x, y);
      await watch.time("glide", () => glideTo(ctx, x, y));
      await watch.time("guard", () => refuseIfBlocked(verdict));
      void ctx.overlay.click();
      const count = action.kind === "double_click" ? 2 : action.kind === "triple_click" ? 3 : 1;
      return clickWatchingForPicker(
        ctx,
        x,
        y,
        {
          button: action.kind === "right_click" ? "right" : "left",
          count,
        },
        watch,
      );
    }
    case "hover": {
      const { x, y } = await watch.time("scroll", () =>
        scrollForAction(cdp, action, ctx.scale(), ctx),
      );
      await watch.time("glide", () => glideTo(ctx, x, y));
      void ctx.overlay.hover(true);
      await watch.time("move", () => moveMouse(cdp, x, y));
      await watch.time("settle", () => settle(ctx, SETTLE_MS));
      return {};
    }
    case "type": {
      if (!action.text) throw new Error("there is no text to type");
      if (await watch.time("focusCheck", () => nothingHasFocus(cdp)))
        throw new Error(NO_FOCUS_MESSAGE);
      const text = action.text;
      await watch.time("type", () => typeText(cdp, text));
      await watch.time("settle", () => settle(ctx, SETTLE_MS / 2));
      return { detail: `${[...action.text].length} characters` };
    }
    case "key": {
      if (!action.keys) throw new Error("there is no key to press");
      const keys = action.keys;
      if (scrollsAPage(keys) && (await watch.time("focusCheck", () => nothingHasFocus(cdp))))
        throw new Error(NO_FOCUS_MESSAGE);
      await watch.time("keys", () => pressKeys(cdp, keys));
      await watch.time("settle", () => settle(ctx, SETTLE_MS));
      return {};
    }
    case "scroll": {
      const { x, y } = point(action, ctx.scale());
      const scale = ctx.scale();
      await watch.time("glide", () => glideTo(ctx, x, y));
      await watch.time("wheel", () =>
        wheelAt(cdp, x, y, (action.dx ?? 0) / scale, (action.dy ?? 0) / scale),
      );
      await watch.time("settle", () => ctx.sleep(SCROLL_SETTLE_MS));
      return {};
    }
    case "upload": {
      if (!action.resume) throw new Error("the server named no résumé to upload");
      const resume = action.resume;
      const file = await watch.time("resumeFetch", () =>
        ctx.resume(resume, action.fileName ?? resume),
      );
      const { x, y } = await watch.time("scroll", () =>
        scrollForAction(cdp, action, ctx.scale(), ctx),
      );
      const verdict = ctx.guard?.(x, y);
      await watch.time("glide", () => glideTo(ctx, x, y));
      await watch.time("guard", () => refuseIfBlocked(verdict));
      void ctx.overlay.click();
      const done = await watch.time("upload", () =>
        uploadAt(cdp, x, y, file, ctx.fileChooserWaitMs),
      );
      await watch.time("uploadProcessing", () => waitForUploadProcessing(cdp, ctx.sleep));
      await watch.time("settle", () => settle(ctx, SETTLE_MS));
      return { detail: `${done.fileName}, ${done.bytes} bytes, through the ${done.via}` };
    }
    case "snap": {
      if (!ctx.snap) throw new Error("the extension cannot take a picture here");
      const snap = ctx.snap;
      await watch.time("snap", () => snap(action));
      return {};
    }
    case "wait": {
      const ms = action.ms ?? 1000;
      await watch.time("wait", () => ctx.sleep(ms));
      return {};
    }
    default:
      throw new Error(`the extension cannot perform "${String(action.kind)}"`);
  }
}

/**
 * A fast-fill plan is carried out zone by zone. When the next action is in another zone (or there is
 * none), the zone just done is photographed. Returns the zone the next action is in.
 */
async function leaveZone(
  ctx: ExecutorContext,
  zone: number | undefined,
  next: number | undefined,
): Promise<number | undefined> {
  if (zone != null && next !== zone) await ctx.zoneDone?.(zone);
  return next ?? zone;
}

/** What a result says of an action that was not run because one before it failed. */
export const SKIPPED_ERROR = "skipped: an earlier action in this step failed";

/** Whether a result is of an action that was skipped, not one that failed. */
export function wasSkipped(result: AgentActionResult): boolean {
  return !result.ok && result.error === SKIPPED_ERROR;
}

/**
 * Runs the actions in order. One that fails stops the batch: what came after it was
 * planned for a page the failed action did not leave behind, so it is reported as skipped
 * and the agent looks at the page again.
 */
export async function runActions(
  ctx: ExecutorContext,
  actions: AgentAction[],
  /** Told the time the batch spent beyond its actions (watching the page's reaction to typing). */
  batch = new Stopwatch(),
): Promise<AgentActionResult[]> {
  const results: AgentActionResult[] = [];
  let failed = false;
  // A step that types is looked at only once the page has answered what the typing asked of it.
  const typing = actions.some((action) => action.kind === "type" || action.kind === "key");
  const effects = typing ? await batch.time("watchInput", () => watchInputEffects(ctx.cdp)) : null;
  let zone: number | undefined;
  // The zone of the last action, as that action itself has it: an action the agent made (a dropdown being
  // opened) has none, and a batch that ends with one ends with a list open, which is not a zone's photo.
  let lastOwnZone: number | undefined;
  for (const action of actions) {
    if (failed) {
      results.push({
        id: action.id,
        ok: false,
        error: SKIPPED_ERROR,
      });
      continue;
    }
    ctx.checkStopped();
    zone = await leaveZone(ctx, zone, action.zone ?? zone);
    lastOwnZone = action.zone;
    // Each action carries when it began and how long it took, and where that time went.
    const watch = new Stopwatch();
    const timing = () => ({ startedAt: watch.startedAt, ms: watch.ms, laps: watch.laps });
    try {
      const done = await perform(ctx, action, watch);
      results.push({
        id: action.id,
        ok: true,
        ...timing(),
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
        ...timing(),
      });
    }
  }
  if (!failed && lastOwnZone != null) await leaveZone(ctx, zone, undefined);
  if (effects) await batch.time("inputSettle", () => effects.settle(ctx.sleep));
  return results;
}
