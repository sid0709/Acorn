/**
 * Performs the agent's actions on the page. Each is something a person does: move the
 * pointer and click, type, press keys, scroll, hand the page a file. The executor knows
 * nothing about forms; it does what it is told and says what happened.
 */

import { clickAt, moveMouse, pressKeys, typeText, wheelAt } from "./input";
import { CURSOR_GLIDE_MS } from "./overlay";
import { uploadAt, type ResumeFile } from "./upload";

import type { Cdp } from "./cdp";
import type { Overlay } from "./overlay";
import type { AgentAction, AgentActionResult } from "@acorn/shared/agent-contract";

/** The pause after an action that changes the page, so what it did has drawn before the next look. */
export const SETTLE_MS = 350;
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
  /** How long an upload waits for the click to open a file picker; the default when unset. */
  fileChooserWaitMs?: number;
}

function point(action: AgentAction, scale: number): { x: number; y: number } {
  if (action.x == null || action.y == null) throw new Error("the action has no point");
  return { x: action.x / scale, y: action.y / scale };
}

/** Moves the visible cursor to the point, and waits for it to arrive, so a person can follow. */
async function glideTo(ctx: ExecutorContext, x: number, y: number): Promise<void> {
  await ctx.overlay.moveTo(x, y);
  await ctx.sleep(CURSOR_GLIDE_MS);
}

type Done = { detail?: string };

async function perform(ctx: ExecutorContext, action: AgentAction): Promise<Done> {
  const { cdp } = ctx;
  switch (action.kind) {
    case "click":
    case "double_click":
    case "triple_click":
    case "right_click": {
      const { x, y } = point(action, ctx.scale());
      await glideTo(ctx, x, y);
      void ctx.overlay.click();
      const count = action.kind === "double_click" ? 2 : action.kind === "triple_click" ? 3 : 1;
      await clickAt(cdp, x, y, { button: action.kind === "right_click" ? "right" : "left", count });
      await ctx.sleep(SETTLE_MS);
      return {};
    }
    case "hover": {
      const { x, y } = point(action, ctx.scale());
      await glideTo(ctx, x, y);
      await moveMouse(cdp, x, y);
      await ctx.sleep(SETTLE_MS);
      return {};
    }
    case "type": {
      if (!action.text) throw new Error("there is no text to type");
      await typeText(cdp, action.text);
      await ctx.sleep(SETTLE_MS / 2);
      return { detail: `${[...action.text].length} characters` };
    }
    case "key": {
      if (!action.keys) throw new Error("there is no key to press");
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
      await glideTo(ctx, x, y);
      void ctx.overlay.click();
      const done = await uploadAt(cdp, x, y, file, ctx.fileChooserWaitMs);
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
): Promise<AgentActionResult[]> {
  const results: AgentActionResult[] = [];
  let failed = false;
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
      results.push({ id: action.id, ok: true, ...(done.detail ? { detail: done.detail } : {}) });
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
  return results;
}
