/**
 * Performs the agent's actions on the page. Each is something a person does: move the
 * pointer and click, type, press keys, scroll, hand the page a file. The executor knows
 * nothing about forms; it does what it is told and says what happened.
 */

import {
  ACTION_KIND,
  ACTION_OPENED,
  TYPED_LIST_SNAP_SUFFIX,
  type ActionKind,
  type ActionOpened,
  type AgentAction,
  type AgentActionResult,
} from "@acorn/shared/agent-contract";

import { NO_FOCUS_MESSAGE, nothingHasFocus, scrollsAPage } from "./focus-guard";
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

/** What the run is told of an action as it goes: it began, it was aimed at a point of the window (CSS pixels), it was done, it failed, or it was skipped. */
export const ACTION_PROGRESS = {
  started: "started",
  aimed: "aimed",
  done: "done",
  failed: "failed",
  skipped: "skipped",
} as const;
export type ActionProgress = (typeof ACTION_PROGRESS)[keyof typeof ACTION_PROGRESS];

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
   * Aims a click onto the small control beside its point (control-snap.ts): the point a click goes to
   * instead, or null to click where planned. A page of any origin says only where things are.
   */
  aim?: (x: number, y: number) => Promise<{ x: number; y: number; detail: string } | null>;
  /** Runs after a click has settled: it closes a frame or window the click opened that is an online file source. */
  afterClick?: () => Promise<void>;
  /** How long an upload waits for the click to open a file picker; the default when unset. */
  fileChooserWaitMs?: number;
  /** Called when the last action of a zone of a fast-fill plan is done: the run takes a photo of the page. */
  zoneDone?: (zone: number) => Promise<void>;
  /** The run's scrolling: the settled parts it keeps out of, and where it tells what it did. */
  scroll?: ScrollContext;
  /** Takes a picture of the page now and sends it to the agent for a `snap` action, which waits for it to arrive. */
  /**
   * Takes the picture of an opened dropdown and sends it; resolves to what the agent says to do at once while
   * the list is open (click the option, type and take another picture, close it).
   */
  snap?: (action: AgentAction) => Promise<AgentAction[]>;
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
  /** Told of each action as it goes (for the map of the page); `at` is the point an action was aimed at, in the window's CSS pixels. */
  progress?: (action: AgentAction, state: ActionProgress, at?: { x: number; y: number }) => void;
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
  ACTION_KIND.select,
]);

/** How far under a field the page is watched for a list of suggestions that typing opens (CSS pixels). */
export const LIST_WATCH_HEIGHT_PX = 260;
/** The least of the page under a field worth watching; a field at the window's bottom is not. */
const LIST_WATCH_MIN_PX = 24;
/** The JPEG quality of the two small pictures compared; they are never shown, only compared. */
const LIST_WATCH_QUALITY = 40;

/** Finds the element at a point of the window, through shadow roots and same-origin frames (page-side). */
const ELEMENT_AT_SCRIPT = `(px, py) => {
  let el = document.elementFromPoint(px, py);
  let ox = px, oy = py;
  for (let depth = 0; el && depth < 8; depth += 1) {
    if (el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(ox, oy);
      if (inner && inner !== el) { el = inner; continue; }
    }
    if (el.tagName === "IFRAME") {
      try {
        const inside = el.contentDocument;
        if (inside) {
          const box = el.getBoundingClientRect();
          ox -= box.left; oy -= box.top;
          const inner = inside.elementFromPoint(ox, oy);
          if (inner) { el = inner; continue; }
        }
      } catch (error) { /* a frame of another origin */ }
    }
    break;
  }
  return el;
}`;

/** What a click is told when the control at its point is the browser's own list: it is focused, never opened. */
export const NATIVE_LIST_FOCUSED_DETAIL =
  "the browser's own list: focused, not opened (its popup is outside the page); its options are in the focus report, so choose it by an option's words";
/** What a key is told when it would open or move the browser's own list, which takes no key from here. */
export const NATIVE_LIST_KEYS_MESSAGE =
  "the focused control is the browser's own list, which no key from here can open or move: choose it by an option's words";
/** The keys that open or move a focused select, each as the model may write it (lower case). */
const NATIVE_LIST_KEYS: ReadonlySet<string> = new Set([
  "arrowdown",
  "arrowup",
  "down",
  "up",
  "home",
  "end",
  "pageup",
  "pagedown",
  "space",
  " ",
  "enter",
  "return",
]);

/** Runs in the page: whether the control at the point is a select element (the browser's own list). */
function isNativeListAtScript(x: number, y: number): string {
  return `((px, py) => {
    const el = (${ELEMENT_AT_SCRIPT})(px, py);
    return Boolean(el && el.closest("select"));
  })(${Number(x)}, ${Number(y)})`;
}

/** Runs in the page: whether the control that has focus is a select element. */
const FOCUS_IS_NATIVE_LIST_SCRIPT = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return Boolean(el && el.tagName === "SELECT");
})()`;

/** Whether a key sequence holds a key that opens or moves a select. */
export function opensANativeList(keys: string): boolean {
  return keys
    .trim()
    .split(/\s+/)
    .some((chord) => NATIVE_LIST_KEYS.has(chord.split("+").pop()?.toLowerCase() ?? ""));
}

/** Runs in the page: gives the control at the point focus without opening anything; its tag, or "" when none. */
function focusAtScript(x: number, y: number): string {
  return `((px, py) => {
    const el = (${ELEMENT_AT_SCRIPT})(px, py);
    const control = el && el.closest("select,input,textarea,button,[tabindex],[contenteditable='true']");
    if (!control) return "";
    control.focus({ preventScroll: true });
    return control.tagName.toLowerCase();
  })(${Number(x)}, ${Number(y)})`;
}

/**
 * Runs in the page: sets the option at `index` of the browser's own list at the point, as a choice from its
 * popup would (the page is told through the input and change events a choice sends), and says the option's
 * words; or why it could not.
 */
function selectAtScript(x: number, y: number, index: number): string {
  return `((px, py, index) => {
    const el = (${ELEMENT_AT_SCRIPT})(px, py);
    const select = el && el.closest("select");
    if (!select) return { error: "there is no browser list at the point" };
    if (index < 0 || index >= select.options.length) return { error: "the list has no option " + (index + 1) };
    select.focus({ preventScroll: true });
    select.selectedIndex = index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { text: select.options[index].text };
  })(${Number(x)}, ${Number(y)}, ${Number(index)})`;
}

/** Runs in the page: where the focused control is in the window, and how large the window is. */
const FOCUSED_RECT_SCRIPT = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, viewW: window.innerWidth, viewH: window.innerHeight };
})()`;

/** Evaluates a page-side expression and returns its value; undefined when the page threw. */
async function evaluate<T>(cdp: Cdp, expression: string): Promise<T | undefined> {
  const answer = await cdp.send<{ result?: { value?: T }; exceptionDetails?: unknown }>(
    "Runtime.evaluate",
    { expression, returnByValue: true },
  );
  return answer.exceptionDetails ? undefined : answer.result?.value;
}

/** A small picture of the page just under the focused field, with where it was taken. */
type BelowPicture = { clip: { x: number; y: number; width: number; height: number }; data: string };

/**
 * Photographs the page under the focused field, before text is typed into it, so what typing brings
 * there (a list of suggestions, a message) shows as a change. Null when there is no field, nothing
 * under it in the window, or the page would not say.
 */
async function pictureBelowFocus(cdp: Cdp): Promise<BelowPicture | null> {
  try {
    const rect = await evaluate<{
      x: number;
      y: number;
      w: number;
      h: number;
      viewW: number;
      viewH: number;
    }>(cdp, FOCUSED_RECT_SCRIPT);
    if (!rect) return null;
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.ceil(rect.y + rect.h) + 1;
    const width = Math.min(Math.floor(rect.w), rect.viewW - x);
    const height = Math.min(LIST_WATCH_HEIGHT_PX, Math.floor(rect.viewH) - y);
    if (width < LIST_WATCH_MIN_PX || height < LIST_WATCH_MIN_PX) return null;
    const clip = { x, y, width, height };
    return { clip, data: await pictureOf(cdp, clip) };
  } catch {
    return null;
  }
}

async function pictureOf(cdp: Cdp, clip: BelowPicture["clip"]): Promise<string> {
  const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "jpeg",
    quality: LIST_WATCH_QUALITY,
    clip: { ...clip, scale: 1 },
    captureBeyondViewport: false,
  });
  return shot.data;
}

/** Whether the page under the field looks different from `before`; false when it cannot be looked at. */
async function belowChanged(cdp: Cdp, before: BelowPicture): Promise<boolean> {
  try {
    return (await pictureOf(cdp, before.clip)) !== before.data;
  } catch {
    return false;
  }
}

function point(action: AgentAction, scale: number): { x: number; y: number } {
  if (action.x == null || action.y == null) throw new Error("the action has no point");
  return { x: action.x / scale, y: action.y / scale };
}

/** Glides the visible cursor to the point and waits for it to arrive, so a person can follow. */
async function glideTo(ctx: ExecutorContext, x: number, y: number): Promise<void> {
  await ctx.overlay.moveTo(x, y);
}

/** What an action did; `then` are actions to carry out next, before the rest of the batch (a snap's answer). */
type Done = { detail?: string; opened?: ActionOpened; then?: AgentAction[] };

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
      const planned = await watch.time("scroll", () =>
        scrollForAction(cdp, action, ctx.scale(), ctx),
      );
      // A point a few pixels off a small control (a check box, a radio) is moved onto it: on a picture the
      // model cannot measure a dozen pixels, and beside the control the click does nothing.
      const aim = ctx.aim;
      const snapped = aim
        ? await watch.time("aim", () => aim(planned.x, planned.y).catch(() => null))
        : null;
      const { x, y } = snapped ?? planned;
      ctx.progress?.(action, ACTION_PROGRESS.aimed, { x, y });
      // Nothing judges the control before the click: the model, which sees the screen, chose it. A window
      // or frame the click opens is judged after the fact, in afterClick and when the run follows it. The
      // one control never clicked is the browser's own list (a select element): its popup is a window of
      // the operating system that no screenshot shows and no click or key reaches, and another run's input
      // in another window closes it. It is given focus instead, and set by an option's place (select).
      await watch.time("glide", () => glideTo(ctx, x, y));
      if (
        await watch.time("listCheck", () =>
          evaluate<boolean>(cdp, isNativeListAtScript(x, y)).catch(() => false),
        )
      ) {
        await evaluate<string>(cdp, focusAtScript(x, y)).catch(() => undefined);
        await watch.time("settle", () => settle(ctx, SETTLE_MS / 2));
        return { detail: NATIVE_LIST_FOCUSED_DETAIL };
      }
      void ctx.overlay.click();
      const count = action.kind === "double_click" ? 2 : action.kind === "triple_click" ? 3 : 1;
      const done = await clickWatchingForPicker(
        ctx,
        x,
        y,
        { button: action.kind === "right_click" ? "right" : "left", count },
        watch,
      );
      return snapped
        ? { ...done, detail: [done.detail, snapped.detail].filter(Boolean).join("; ") }
        : done;
    }
    case "hover": {
      const { x, y } = await watch.time("scroll", () =>
        scrollForAction(cdp, action, ctx.scale(), ctx),
      );
      ctx.progress?.(action, ACTION_PROGRESS.aimed, { x, y });
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
      // What lies under the field before the typing: a box that suggests matches as one types (a city, an
      // address) opens its list there, and only the typing tells such a box from a plain one. A run that
      // cannot ask the agent about a picture (no snap) types as before.
      const snap = action.secret ? undefined : ctx.snap;
      const below = snap ? await watch.time("listWatch", () => pictureBelowFocus(cdp)) : null;
      await watch.time("type", () => typeText(cdp, text, ctx.sleep));
      await watch.time("settle", () => settle(ctx, SETTLE_MS / 2));
      const done: Done = { detail: `${[...action.text].length} characters` };
      if (snap && below && (await watch.time("listWatch", () => belowChanged(cdp, below)))) {
        // Something appeared under the field. The agent reads the picture as it reads a dropdown's: it
        // answers with the suggestion to click, a moment to wait for a list still loading, or nothing when
        // what appeared is no list (a message, a counter).
        done.then = await watch.time("snap", () =>
          snap({ id: action.id + TYPED_LIST_SNAP_SUFFIX, kind: "snap", zone: action.zone }),
        );
      }
      return done;
    }
    case "focus": {
      const { x, y } = await watch.time("scroll", () =>
        scrollForAction(cdp, action, ctx.scale(), ctx),
      );
      ctx.progress?.(action, ACTION_PROGRESS.aimed, { x, y });
      await watch.time("glide", () => glideTo(ctx, x, y));
      const tag = await watch.time("focus", () => evaluate<string>(cdp, focusAtScript(x, y)));
      if (!tag) throw new Error("there is no control to focus at the point");
      await watch.time("settle", () => settle(ctx, SETTLE_MS / 2));
      return { detail: `focused the ${tag}` };
    }
    case "select": {
      if (action.index == null) throw new Error("the select names no option");
      const index = action.index;
      const { x, y } = await watch.time("scroll", () =>
        scrollForAction(cdp, action, ctx.scale(), ctx),
      );
      ctx.progress?.(action, ACTION_PROGRESS.aimed, { x, y });
      await watch.time("glide", () => glideTo(ctx, x, y));
      void ctx.overlay.click();
      const set = await watch.time("select", () =>
        evaluate<{ error?: string; text?: string }>(cdp, selectAtScript(x, y, index)),
      );
      if (!set || set.error) throw new Error(set?.error ?? "the page would not set the list");
      await watch.time("settle", () => settle(ctx, SETTLE_MS));
      await watch.time("afterClick", async () => ctx.afterClick?.());
      return { detail: `option ${index + 1} "${set.text ?? ""}"` };
    }
    case "key": {
      if (!action.keys) throw new Error("there is no key to press");
      const keys = action.keys;
      if (scrollsAPage(keys) && (await watch.time("focusCheck", () => nothingHasFocus(cdp))))
        throw new Error(NO_FOCUS_MESSAGE);
      // A key that would open or move the browser's own list is not sent: its popup takes nothing from here
      // (a recorded run sent ArrowDown and Enter to one six times, each reported done, and nothing changed).
      if (
        opensANativeList(keys) &&
        (await watch.time("focusCheck", () =>
          evaluate<boolean>(cdp, FOCUS_IS_NATIVE_LIST_SCRIPT).catch(() => false),
        ))
      )
        throw new Error(NATIVE_LIST_KEYS_MESSAGE);
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
      ctx.progress?.(action, ACTION_PROGRESS.aimed, { x, y });
      await watch.time("glide", () => glideTo(ctx, x, y));
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
      const then = await watch.time("snap", () => snap(action));
      return { then };
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

/** The kinds of action that reach a control of their own, at a point: what follows one of them (typing, keys) is meant for that control. */
const REACHES_A_CONTROL: ReadonlySet<string> = new Set([
  "click",
  "double_click",
  "triple_click",
  "right_click",
  "hover",
  "upload",
  "focus",
  "select",
]);

/** Whether an action reaches a control of its own. */
function reachesAControl(action: AgentAction): boolean {
  return REACHES_A_CONTROL.has(action.kind) && action.x != null && action.y != null;
}

/** Whether a result is of an action that was skipped, not one that failed. */
export function wasSkipped(result: AgentActionResult): boolean {
  return !result.ok && result.error === SKIPPED_ERROR;
}

/**
 * Runs the actions in order. One that fails stops the batch: what came after it was planned for a page
 * the failed action did not leave behind, so it is reported as skipped and the agent looks at the page
 * again. The exception is typing or a key refused because nothing has focus: the click before it reached
 * no control, and the page is as it was, so only what was meant for that control is skipped (up to the
 * next action that reaches a control of its own) and the rest of the batch goes on. A recorded run lost
 * eighteen planned actions, and a look, to each of nine such refusals on one phone box.
 */
export async function runActions(
  ctx: ExecutorContext,
  actions: AgentAction[],
  /** Told the time the batch spent beyond its actions (watching the page's reaction to typing). */
  batch = new Stopwatch(),
): Promise<AgentActionResult[]> {
  const results: AgentActionResult[] = [];
  let failed = false;
  // Set while what was meant for a control that was not reached is being skipped.
  let unreached = false;
  // A step that types is looked at only once the page has answered what the typing asked of it. A dropdown's
  // picture may be answered with typing too.
  const typing = actions.some(
    (action) => action.kind === "type" || action.kind === "key" || action.kind === "snap",
  );
  const effects = typing ? await batch.time("watchInput", () => watchInputEffects(ctx.cdp)) : null;
  let zone: number | undefined;
  // The zone of the last action, as that action itself has it: an action the agent made (a dropdown being
  // opened) has none, and a batch that ends with one ends with a list open, which is not a zone's photo.
  let lastOwnZone: number | undefined;
  // After a résumé is attached the page reads it and moves its fields for a moment: the next click waits
  // until the form stops moving, so it lands where the field is, not where it was.
  let afterUpload = false;
  // A snap's answer is carried out next, before the rest of the batch: the queue grows as the batch runs.
  const queue = [...actions];
  for (let index = 0; index < queue.length; index += 1) {
    const action = queue[index];
    if (unreached && reachesAControl(action)) unreached = false;
    if (failed || unreached) {
      results.push({
        id: action.id,
        ok: false,
        error: SKIPPED_ERROR,
        ...(failed ? {} : { unreached: true }),
      });
      ctx.progress?.(action, ACTION_PROGRESS.skipped);
      continue;
    }
    ctx.checkStopped();
    zone = await leaveZone(ctx, zone, action.zone ?? zone);
    lastOwnZone = action.zone;
    // Each action carries when it began and how long it took, and where that time went.
    const watch = new Stopwatch();
    const timing = () => ({ startedAt: watch.startedAt, ms: watch.ms, laps: watch.laps });
    ctx.progress?.(action, ACTION_PROGRESS.started);
    if (afterUpload && reachesAControl(action) && action.kind !== "upload") {
      afterUpload = false;
      await watch.time("formSettle", () => ctx.marks?.settle?.() ?? Promise.resolve());
    }
    try {
      const done = await perform(ctx, action, watch);
      if (action.kind === "upload") afterUpload = true;
      if (done.then?.length) queue.splice(index + 1, 0, ...done.then);
      results.push({
        id: action.id,
        ok: true,
        ...timing(),
        ...(done.detail ? { detail: done.detail } : {}),
        ...(done.opened ? { opened: done.opened } : {}),
      });
      ctx.progress?.(action, ACTION_PROGRESS.done);
    } catch (err) {
      ctx.checkStopped();
      const error = err instanceof Error ? err.message : String(err);
      // A key refused because nothing has focus, or because the focused control is the browser's own list,
      // left the page as it was: only what was meant for that control is skipped.
      const unreachedNow = error === NO_FOCUS_MESSAGE || error === NATIVE_LIST_KEYS_MESSAGE;
      if (unreachedNow) unreached = true;
      else failed = true;
      results.push({
        id: action.id,
        ok: false,
        error,
        ...(unreachedNow ? { unreached: true } : {}),
        ...timing(),
      });
      ctx.progress?.(action, ACTION_PROGRESS.failed);
    }
  }
  if (!failed && lastOwnZone != null) await leaveZone(ctx, zone, undefined);
  if (effects) await batch.time("inputSettle", () => effects.settle(ctx.sleep));
  return results;
}
