/**
 * Doing one fill of the quick text pass with the same real mouse and keyboard the model's own actions
 * use: the extension's executor (`runActions`) clicks at a point and types, as a person would. The page
 * is asked only to say what an element is and where it is, and what it holds afterwards; it is never
 * handed a value or an event. A field that does not show the answer afterwards is reported, so the
 * model's look repairs it.
 */

import { ACTION_KIND, PREFILL_ACTION } from "@acorn/shared/agent-contract";

import { runActions, type ExecutorContext } from "../executor";

import { rewriteApplicantIdentityValue } from "./applicant-identity";
import { askFrame, toTabViewport, type FrameInfo } from "./frames";
import { PREFILL_MESSAGE, type Described, type Located, type ReadBack } from "./messages";
import { PREFILL_REVEAL_MS, PREFILL_SECRET_SHOWN, PREFILL_SETTLE_MS } from "./settings";

import type { AgentAction, AgentPrefillFill } from "@acorn/shared/agent-contract";

/** What the fill needs from the run. */
export interface FillContext {
  tabId: number;
  frames: FrameInfo[];
  /** The run's executor, with points in the tab's own CSS pixels. */
  executor: ExecutorContext;
  /** Waits; rejects when the person presses Stop. */
  sleep(ms: number): Promise<void>;
  /** Throws when the person pressed Stop. */
  checkStopped(): void;
}

/** What came of one fill. */
export type FillOutcome =
  | { status: "filled"; shown: string }
  | { status: "skipped"; why: string }
  | { status: "failed"; error: string };

const failed = (error: string): FillOutcome => ({ status: "failed", error });

/** Text with its spacing and case set aside, to compare what was meant with what the page shows. */
function plain(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The digits of a text, for a field that formats what it is given (a phone number). */
function digits(text: string): string {
  return text.replace(/\D/g, "");
}

/** Whether the field shows what was meant, allowing for a page that formats or trims it. */
export function showsAnswer(shown: string, meant: string): boolean {
  if (!shown.trim()) return false;
  if (plain(shown) === plain(meant)) return true;
  const wanted = digits(meant);
  return wanted.length >= 3 && digits(shown) === wanted;
}

/** The value as a human applicant gives it (Oak's rule, `applicant-identity.ts`), checked against the question. */
function intended(fill: AgentPrefillFill, described: Extract<Described, { ok: true }>): string {
  return (
    rewriteApplicantIdentityValue(`${fill.label ?? ""} ${described.question}`, fill.value) ?? ""
  );
}

/** Where to click an element, in the tab's viewport: scrolled into view, measured, carried up through its frames. */
export async function pointOf(
  ctx: FillContext,
  frameId: number,
  nodeId: number,
): Promise<{ x: number; y: number } | string> {
  await askFrame(ctx.tabId, frameId, { type: PREFILL_MESSAGE.reveal, nodeId });
  await ctx.sleep(PREFILL_REVEAL_MS);
  const located = await askFrame<Located>(ctx.tabId, frameId, {
    type: PREFILL_MESSAGE.locate,
    nodeId,
  });
  if (!located) return "the page did not say where the field is";
  if (!located.ok) return located.error;
  const inTab = await toTabViewport(ctx.tabId, ctx.frames, frameId, located, ctx.sleep);
  return inTab ?? "could not tell where the frame holding the field sits on the screen";
}

/** Runs actions with the executor; the error of the first that failed, or null. */
export async function act(ctx: FillContext, actions: AgentAction[]): Promise<string | null> {
  // One settle for the whole pass, not one per field (`run.ts`).
  const results = await runActions(ctx.executor, actions, { settle: false });
  const bad = results.find((result) => !result.ok);
  return bad ? (bad.error ?? "the action failed") : null;
}

async function readBack(
  ctx: FillContext,
  frameId: number,
  nodeId: number,
): Promise<ReadBack | null> {
  await ctx.sleep(PREFILL_SETTLE_MS);
  return askFrame<ReadBack>(ctx.tabId, frameId, { type: PREFILL_MESSAGE.read, nodeId });
}

async function fillTextBox(
  ctx: FillContext,
  frameId: number,
  fill: AgentPrefillFill,
  described: Extract<Described, { ok: true }>,
): Promise<FillOutcome> {
  if (!described.empty) return { status: "skipped", why: "it already holds a value" };
  // The account password is typed as the server sent it: no wording rule reads it, and nothing shows it.
  const value = fill.secret ? (fill.value ?? "") : intended(fill, described);
  if (!value) return failed("there is nothing to type");
  if (described.maxLength > 0 && [...value].length > described.maxLength) {
    return failed(`the text is longer than the ${described.maxLength} characters the field takes`);
  }
  const point = await pointOf(ctx, frameId, fill.ref);
  if (typeof point === "string") return failed(point);
  const error = await act(ctx, [
    { id: "p1", kind: ACTION_KIND.click, x: point.x, y: point.y },
    { id: "p2", kind: ACTION_KIND.type, text: value },
  ]);
  if (error) return failed(error);
  const read = await readBack(ctx, frameId, fill.ref);
  if (read?.ok && showsAnswer(read.value, value)) {
    return { status: "filled", shown: fill.secret ? PREFILL_SECRET_SHOWN : read.value };
  }
  if (fill.secret)
    return failed(
      read?.ok && read.value ? "the field shows something else" : "the field stayed empty",
    );
  return failed(
    read?.ok && read.value.trim() ? `the field shows "${read.value}"` : "the field stayed empty",
  );
}

async function fillList(
  ctx: FillContext,
  frameId: number,
  fill: AgentPrefillFill,
  described: Extract<Described, { ok: true }>,
): Promise<FillOutcome> {
  if (!described.empty) return { status: "skipped", why: "it already holds a value" };
  const value = intended(fill, described);
  const option = described.options.find((candidate) => plain(candidate) === plain(value));
  if (!option) return failed(`the list has no option "${value}"`);
  const point = await pointOf(ctx, frameId, fill.ref);
  if (typeof point === "string") return failed(point);
  // A native list opens on a click and takes the start of an option typed at it (docs 19.10, item 2).
  const error = await act(ctx, [
    { id: "p1", kind: ACTION_KIND.click, x: point.x, y: point.y },
    { id: "p2", kind: ACTION_KIND.type, text: option },
    { id: "p3", kind: ACTION_KIND.key, keys: "Enter" },
  ]);
  if (error) return failed(error);
  const read = await readBack(ctx, frameId, fill.ref);
  if (read?.ok && plain(read.selected) === plain(option))
    return { status: "filled", shown: read.selected };
  return failed(
    read?.ok && read.selected ? `the list shows "${read.selected}"` : "the list took no option",
  );
}

async function fillGroup(
  ctx: FillContext,
  frameId: number,
  fill: AgentPrefillFill,
  described: Extract<Described, { ok: true }>,
): Promise<FillOutcome> {
  if (!described.empty) return { status: "skipped", why: "a choice is already made" };
  const value = intended(fill, described);
  const member = described.members.find((candidate) => plain(candidate.label) === plain(value));
  if (!member) return failed(`the page has no option "${value}"`);
  const point = await pointOf(ctx, frameId, member.nodeId);
  if (typeof point === "string") return failed(point);
  const error = await act(ctx, [{ id: "p1", kind: ACTION_KIND.click, x: point.x, y: point.y }]);
  if (error) return failed(error);
  const read = await readBack(ctx, frameId, member.nodeId);
  return read?.ok && read.checked
    ? { status: "filled", shown: member.label }
    : failed("the option did not stay chosen");
}

/** Makes one fill in the frame the page was serialized from. */
export async function fillOne(
  ctx: FillContext,
  frameId: number,
  fill: AgentPrefillFill,
): Promise<FillOutcome> {
  ctx.checkStopped();
  const described = await askFrame<Described>(ctx.tabId, frameId, {
    type: PREFILL_MESSAGE.describe,
    nodeId: fill.ref,
  });
  if (!described) return failed("the page did not answer");
  if (!described.ok) return failed(described.error);
  // A search box that picks from a list is not a place text goes: typing into it leaves a word in the box and
  // nothing chosen. The choice pass opens it and picks an option.
  if (described.kind === "text" && described.listPicker) {
    return { status: "skipped", why: "it picks from a list: the choice pass does it" };
  }
  if (fill.action === PREFILL_ACTION.selectRadio) {
    return described.kind === "radio" || described.kind === "checkbox"
      ? fillGroup(ctx, frameId, fill, described)
      : failed("it is not a radio button or a checkbox");
  }
  switch (described.kind) {
    case "text":
      return fillTextBox(ctx, frameId, fill, described);
    case "select":
      return fillList(ctx, frameId, fill, described);
    default:
      return failed("it is not a text box or a list");
  }
}
