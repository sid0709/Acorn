/**
 * The choice pass: the questions of the page that are a choice among options (a list the page draws,
 * a group of radio buttons, yes/no buttons, a group of checkboxes). The text pass leaves what it
 * cannot answer from text; here the extension opens each list with a real click and reads its options,
 * the server's decision model answers every question from the applicant's details with a probability
 * for each option, and a clear answer is clicked with the same real mouse. A doubtful one is left to the
 * model's own look. Nothing here reads the words of a question or an option.
 */

import { ACTION_KIND, AGENT_ERROR_CODE, PICK_KIND } from "@acorn/shared/agent-contract";

import { AgentApiError, requestPick } from "../client";

import { rewriteApplicantIdentityValue } from "./applicant-identity";
import { act, type FillContext } from "./fill";
import { askFrame, listFrames, toTabViewport } from "./frames";
import { PREFILL_MESSAGE } from "./messages";
import {
  PREFILL_FILL_TIMEOUT_MS,
  PREFILL_LIST_OPEN_MS,
  PREFILL_REVEAL_MS,
  PREFILL_SETTLE_MS,
} from "./settings";

import type { ExecutorContext } from "../executor";
import type {
  ChoiceLocated,
  ChoiceOptions,
  ChoiceScan,
  ChoiceState,
  ChoiceWidget,
} from "./messages";
import type {
  AgentPickField,
  AgentPickResult,
  AgentPrefillLine,
} from "@acorn/shared/agent-contract";

/** A choice found in a frame. */
interface Found {
  frameId: number;
  widget: ChoiceWidget;
  /** The options to answer among: a group's own, or a list's once it was opened. */
  options: string[];
}

/** Remembers the choices already asked about, so each is asked once. */
export class ChoiceGate {
  private readonly attempted = new Set<string>();

  has(frameId: number, widget: ChoiceWidget): boolean {
    return this.attempted.has(this.key(frameId, widget));
  }

  mark(frameId: number, widget: ChoiceWidget): void {
    this.attempted.add(this.key(frameId, widget));
  }

  private key(frameId: number, widget: ChoiceWidget): string {
    return [frameId, widget.kind, widget.question, widget.options.join("|")].join("::");
  }
}

export interface ChoicesArgs {
  agentUrl: string;
  sessionId: string;
  gate: ChoiceGate;
  tabId: number;
  /** The run's executor, with points in the tab's own CSS pixels. */
  executor: ExecutorContext;
  signal: AbortSignal;
  sleep(ms: number): Promise<void>;
  checkStopped(): void;
  url: string;
  title: string;
  /** Called once the choices are known, before the first click, so the overlay can say so. */
  onFilling?: () => void;
  /** Called after each choice with what came of it and how long it took. */
  onChoice?: (status: "filled" | "failed", ms: number, label: string, error?: string) => void;
}

export interface ChoicesOutcome {
  filled: AgentPrefillLine[];
  failed: AgentPrefillLine[];
  result: AgentPickResult;
}

const plain = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The promise's value, or `fallback` once `ms` have passed: a stalled choice must not stall the run. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Where to click a choice or one of its options, in the tab's viewport; a string says why not. */
async function pointOfChoice(
  ctx: FillContext,
  frameId: number,
  id: number,
  option?: number,
): Promise<{ x: number; y: number } | string> {
  const located = await askFrame<ChoiceLocated>(ctx.tabId, frameId, {
    type: PREFILL_MESSAGE.choiceLocate,
    id,
    ...(option === undefined ? {} : { option }),
  });
  if (!located) return "the page did not say where it is";
  if (!located.ok) return located.error;
  await ctx.sleep(PREFILL_REVEAL_MS);
  const inTab = await toTabViewport(ctx.tabId, ctx.frames, frameId, located, ctx.sleep);
  return inTab ?? "could not tell where the frame holding it sits on the screen";
}

const closeList = (ctx: FillContext): Promise<string | null> =>
  act(ctx, [{ id: "c1", kind: ACTION_KIND.key, keys: "Escape" }]);

/** Opens a list with a real click and reads its options; null says why it could not. */
async function openList(
  ctx: FillContext,
  frameId: number,
  id: number,
): Promise<ChoiceOptions | { ok: false; error: string }> {
  const point = await pointOfChoice(ctx, frameId, id);
  if (typeof point === "string") return { ok: false, error: point };
  const error = await act(ctx, [{ id: "o1", kind: ACTION_KIND.click, x: point.x, y: point.y }]);
  if (error) return { ok: false, error };
  await ctx.sleep(PREFILL_LIST_OPEN_MS);
  const options = await askFrame<ChoiceOptions>(ctx.tabId, frameId, {
    type: PREFILL_MESSAGE.choiceOptions,
    id,
  });
  return options ?? { ok: false, error: "the page did not answer" };
}

/** The choices of every frame that have not been asked about and are not answered yet. */
async function scanFresh(args: ChoicesArgs, ctx: FillContext): Promise<Found[]> {
  const fresh: Found[] = [];
  for (const frame of ctx.frames) {
    const scan = await askFrame<ChoiceScan>(args.tabId, frame.frameId, {
      type: PREFILL_MESSAGE.choices,
    });
    if (!scan?.ok) continue;
    for (const widget of scan.widgets) {
      // A choice with no words asking it cannot be answered from the applicant's details: it is not guessed at.
      if (widget.question.trim() && !widget.answered && !args.gate.has(frame.frameId, widget)) {
        fresh.push({ frameId: frame.frameId, widget, options: widget.options });
      }
    }
  }
  return fresh;
}

/** Opens each list with a real click to read its options; keeps the choices that can be asked. */
async function readOptions(args: ChoicesArgs, ctx: FillContext, fresh: Found[]): Promise<Found[]> {
  const found: Found[] = [];
  for (const item of fresh) {
    args.gate.mark(item.frameId, item.widget);
    args.checkStopped();
    if (item.widget.kind !== "dropdown") {
      found.push(item);
      continue;
    }
    const opened = await within(
      openList(ctx, item.frameId, item.widget.id),
      PREFILL_FILL_TIMEOUT_MS,
      { ok: false, error: "the list took too long" } as const,
    );
    await closeList(ctx);
    await ctx.sleep(PREFILL_SETTLE_MS);
    // A list that already shows a chosen option was answered; one that opened no options is left alone.
    if (opened.ok && opened.selected < 0) found.push({ ...item, options: opened.options });
  }
  return found;
}

/** Clicks the option the server chose for one choice and checks that the page shows it. */
async function applyPick(
  ctx: FillContext,
  item: Found,
  choices: number[],
): Promise<{ shown: string } | { error: string }> {
  const { frameId, widget, options } = item;
  const meant = choices.map((i) => options[i]).filter(Boolean);
  if (!meant.length) return { error: "no option was chosen" };
  // The applicant is a human (applicant-identity.ts): a yes to a question about using AI is not clicked.
  for (const option of meant) {
    if ((rewriteApplicantIdentityValue(widget.question, option) ?? option) !== option) {
      return { error: "left to the model: it asks about AI or automated tools" };
    }
  }
  if (widget.kind === "dropdown") {
    const before = await askFrame<ChoiceState>(ctx.tabId, frameId, {
      type: PREFILL_MESSAGE.choiceState,
      id: widget.id,
    });
    const opened = await openList(ctx, frameId, widget.id);
    if (!opened.ok) return { error: opened.error };
    const index = opened.options.findIndex((candidate) => plain(candidate) === plain(meant[0]));
    if (index < 0) {
      await closeList(ctx);
      return { error: "the list no longer shows that option" };
    }
    const point = await pointOfChoice(ctx, frameId, widget.id, index);
    if (typeof point === "string") return { error: point };
    const error = await act(ctx, [{ id: "p1", kind: ACTION_KIND.click, x: point.x, y: point.y }]);
    if (error) return { error };
    await ctx.sleep(PREFILL_SETTLE_MS);
    const after = await askFrame<ChoiceState>(ctx.tabId, frameId, {
      type: PREFILL_MESSAGE.choiceState,
      id: widget.id,
    });
    const text = after?.ok ? after.text : "";
    const changed = !before?.ok || plain(before.text) !== plain(text);
    return text && changed && plain(text).includes(plain(meant[0]).slice(0, 12))
      ? { shown: meant[0] }
      : text && changed
        ? { shown: text }
        : { error: "the list did not show the choice" };
  }
  for (const index of choices) {
    const point = await pointOfChoice(ctx, frameId, widget.id, index);
    if (typeof point === "string") return { error: point };
    const error = await act(ctx, [
      { id: `p${index}`, kind: ACTION_KIND.click, x: point.x, y: point.y },
    ]);
    if (error) return { error };
    await ctx.sleep(PREFILL_SETTLE_MS);
  }
  const state = await askFrame<ChoiceState>(ctx.tabId, frameId, {
    type: PREFILL_MESSAGE.choiceState,
    id: widget.id,
  });
  return state?.ok && choices.every((i) => state.chosen.includes(i))
    ? { shown: meant.join("; ") }
    : { error: "the choice did not stay chosen" };
}

/** Runs the choice pass for the page as it is now; null when there was nothing worth asking. */
export async function runChoices(args: ChoicesArgs): Promise<ChoicesOutcome | null> {
  const frames = await listFrames(args.tabId);
  const ctx: FillContext = {
    tabId: args.tabId,
    frames,
    executor: args.executor,
    sleep: args.sleep,
    checkStopped: args.checkStopped,
  };
  const fresh = await scanFresh(args, ctx);
  if (fresh.length === 0) return null;
  // Asked of the server before any list is opened: while the model's own plan is typing into the page, nothing here begins.
  const may = await requestPick(
    args.agentUrl,
    args.sessionId,
    { url: args.url, title: args.title, fields: [] },
    args.signal,
  ).then(
    () => true,
    (err: unknown) => {
      if (err instanceof AgentApiError && err.code === AGENT_ERROR_CODE.prefillBusy) return false;
      throw err;
    },
  );
  if (!may) return null;
  const found = await readOptions(args, ctx, fresh);
  if (found.length === 0) return null;

  const fields: AgentPickField[] = found.map((item, ref) => ({
    ref,
    kind: item.widget.kind === "boxes" ? PICK_KIND.many : PICK_KIND.one,
    question: item.widget.question,
    options: item.options,
  }));
  const result = await requestPick(
    args.agentUrl,
    args.sessionId,
    { url: args.url, title: args.title, fields },
    args.signal,
  );
  const picks = result.picks ?? [];
  if (picks.length > 0) args.onFilling?.();
  const filled: AgentPrefillLine[] = [];
  const failed: AgentPrefillLine[] = [];
  for (const pick of picks) {
    const item = found[pick.ref];
    if (!item) continue;
    const label = item.widget.question || "(a choice with no label)";
    const began = Date.now();
    const outcome = await within(applyPick(ctx, item, pick.choices), PREFILL_FILL_TIMEOUT_MS, {
      error: "the choice took too long",
    });
    if ("shown" in outcome) {
      filled.push({ label, value: outcome.shown });
      args.onChoice?.("filled", Date.now() - began, label);
    } else {
      failed.push({ label, error: outcome.error });
      args.onChoice?.("failed", Date.now() - began, label, outcome.error);
    }
  }
  return { filled, failed, result };
}
