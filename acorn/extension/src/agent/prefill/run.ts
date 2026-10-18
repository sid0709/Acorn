/**
 * The quick text pass of one look: serialize the page, ask the server to answer its plain fields in
 * text, type the answers with the run's own mouse and keyboard, and report what happened. It changes
 * nothing about the run when it finds nothing to do or when anything in it fails: the model's own look
 * comes next either way.
 */

import { AGENT_ERROR_CODE } from "@acorn/shared/agent-contract";

import { AgentApiError, requestPrefill } from "../client";
import { watchInputEffects } from "../input-settle";

import { runChoices, type ChoiceGate } from "./choices";
import { fillOne, type FillOutcome } from "./fill";
import { listFrames, scanFrames, serializeFrame } from "./frames";
import { withoutSecrets } from "./redact";
import {
  PREFILL_FILL_TIMEOUT_MS,
  PREFILL_TOTAL_TIMEOUT_MS,
  PREFILL_TREE_MAX_CHARS,
} from "./settings";
import { formatAnalyzeTrees } from "./tree-export";

import type { ExecutorContext } from "../executor";
import type { PrefillGate } from "./fields";
import type {
  AgentPrefillLine,
  AgentPrefillPlan,
  AgentPickResult,
  AgentPrefillReport,
} from "@acorn/shared/agent-contract";

/** What the pass did, for the next observation, and what the server said, for the run's counters and trace. */
export interface PrefillOutcome {
  report: AgentPrefillReport;
  plan: AgentPrefillPlan;
  /** Fields the plan named that already held a value, or a choice. */
  skipped: number;
  /** What the choice pass cost, when it ran (the server's cumulative use, and its trace). */
  choices?: AgentPickResult;
}

export interface PrefillArgs {
  agentUrl: string;
  sessionId: string;
  gate: PrefillGate;
  /** The choices already asked about. */
  choiceGate: ChoiceGate;
  tabId: number;
  /** The run's executor, with points in the tab's own CSS pixels. */
  executor: ExecutorContext;
  signal: AbortSignal;
  sleep(ms: number): Promise<void>;
  checkStopped(): void;
  /**
   * Called with what was decided at this look: `skip` (too few new empty fields), `wait` (a file input:
   * the model uploads the résumé first), `busy` (the model's plan is still being carried out), `run`.
   */
  onDecision?: (decision: "skip" | "wait" | "busy" | "run", fresh: number) => void;
  /** Called when the pass is about to type, so the overlay can say so. */
  onFilling?: () => void;
  /** Called after each choice (a list, a group of options) with what came of it. */
  onChoice?: (status: "filled" | "failed", ms: number, label: string, error?: string) => void;
  /** Called after each fill with how many are done of how many, what came of it and how long it took. */
  onFill?: (
    done: number,
    total: number,
    status: FillOutcome["status"],
    ms: number,
    label: string,
    error?: string,
  ) => void;
}

/** What a field that took too long is reported as. */
const TOO_SLOW: FillOutcome = { status: "failed", error: "the field took too long" };

/** The promise's value, or `fallback` once `ms` have passed: a stalled field must not stall the run. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The page as lines, cut at a line when it is longer than a pass sends. */
function pageText(tree: Parameters<typeof formatAnalyzeTrees>[0]): string {
  const text = formatAnalyzeTrees(tree).pureTree;
  if (text.length <= PREFILL_TREE_MAX_CHARS) return text;
  return text.slice(0, text.lastIndexOf("\n", PREFILL_TREE_MAX_CHARS));
}

/** The text half of the pass: the plain fields, answered in text and typed. "busy" when the model's plan is typing. */
async function runTextPass(
  args: PrefillArgs,
  frames: Awaited<ReturnType<typeof listFrames>>,
  decision: Extract<ReturnType<PrefillGate["assess"]>, { kind: "run" }>,
): Promise<PrefillOutcome | "busy" | null> {
  const { frameId, fresh } = decision;
  // Serialized again, now that a pass is to be made: the numbers in this tree are the ones the fills use.
  const page = await serializeFrame(args.tabId, frameId);
  if (!page) return null;

  let plan: AgentPrefillPlan;
  try {
    plan = await requestPrefill(
      args.agentUrl,
      args.sessionId,
      { url: page.url, title: page.title, tree: pageText(withoutSecrets(page.tree)) },
      args.signal,
    );
  } catch (err) {
    // The model is still carrying out its own plan on these fields: they are asked about later.
    if (err instanceof AgentApiError && err.code === AGENT_ERROR_CODE.prefillBusy) {
      args.onDecision?.("busy", fresh.length);
      return "busy";
    }
    // Any other failure is not retried for the same fields, or a broken pass would repeat every look.
    args.gate.attempt(fresh);
    throw err;
  }
  args.gate.attempt(fresh);
  args.onDecision?.("run", fresh.length);

  const filled: AgentPrefillLine[] = [];
  const failed: AgentPrefillLine[] = [];
  let skipped = 0;
  const fills = plan.fills ?? [];
  if (fills.length > 0) args.onFilling?.();
  // The page is given its beat and its requests once, after the last field, not after each.
  const effects = fills.length > 0 ? await watchInputEffects(args.executor.cdp) : null;
  const deadline = Date.now() + PREFILL_TOTAL_TIMEOUT_MS;
  let done = 0;
  for (const fill of fills) {
    if (Date.now() > deadline) break;
    const label = fill.label || "(a field with no label)";
    const began = Date.now();
    const outcome = await within(
      fillOne(
        {
          tabId: args.tabId,
          frames,
          executor: args.executor,
          sleep: args.sleep,
          checkStopped: args.checkStopped,
        },
        frameId,
        fill,
      ),
      PREFILL_FILL_TIMEOUT_MS,
      TOO_SLOW,
    );
    done += 1;
    args.onFill?.(
      done,
      fills.length,
      outcome.status,
      Date.now() - began,
      label,
      outcome.status === "failed" ? outcome.error : undefined,
    );
    if (outcome.status === "filled") filled.push({ label, value: outcome.shown });
    else if (outcome.status === "failed") failed.push({ label, error: outcome.error });
    else skipped += 1;
  }
  await effects?.settle(args.sleep);
  return { report: { filled, failed }, plan, skipped };
}

/**
 * Runs the quick pass for the page as it is now: the plain fields in text, then the choices among options
 * (lists the page draws, radio buttons, yes/no buttons, checkboxes). Null when there was nothing worth doing.
 */
export async function runPrefill(args: PrefillArgs): Promise<PrefillOutcome | null> {
  const frames = await listFrames(args.tabId);
  const decision = args.gate.assess(await scanFrames(args.tabId, frames));
  let text: PrefillOutcome | null = null;
  if (decision.kind === "run") {
    const outcome = await runTextPass(args, frames, decision);
    if (outcome === "busy") return null;
    text = outcome;
  } else {
    args.onDecision?.(decision.kind, decision.fresh);
    // A page that can fill itself from a résumé is left alone first, as for the plain fields.
    if (decision.kind === "wait") return null;
  }
  const tab = await chrome.tabs.get(args.tabId).catch(() => null);
  const choices = await runChoices({
    agentUrl: args.agentUrl,
    sessionId: args.sessionId,
    gate: args.choiceGate,
    tabId: args.tabId,
    executor: args.executor,
    signal: args.signal,
    sleep: args.sleep,
    checkStopped: args.checkStopped,
    url: tab?.url ?? "",
    title: tab?.title ?? "",
    onFilling: args.onFilling,
    onChoice: args.onChoice,
  });
  if (!choices) return text;
  const report: AgentPrefillReport = {
    filled: [...(text?.report.filled ?? []), ...choices.filled],
    failed: [...(text?.report.failed ?? []), ...choices.failed],
  };
  return {
    report,
    plan: text?.plan ?? { fills: null, usage: choices.result.usage },
    skipped: text?.skipped ?? 0,
    choices: choices.result,
  };
}
