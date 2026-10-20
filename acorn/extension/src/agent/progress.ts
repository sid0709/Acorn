/**
 * How an agent Run's state reaches the sidebar: the same PipelineProgress and RunReport the
 * rest of the sidebar already shows, so the Now card, its timer and its failure text work
 * as they do for any Run.
 */

import {
  AGENT_ERROR_CODE,
  AGENT_STATUS,
  type AgentAsk,
  type AgentStop,
  type AgentUsage,
} from "@acorn/shared/agent-contract";
import { formatUsd } from "@acorn/shared/ai-usage";
import {
  RUN_FAILURE_REASON,
  RUN_OUTCOME,
  RUN_STAGE,
  type MailSearch,
  type RunFailure,
  type RunMap,
  type RunProgress,
  type RunReport,
} from "@acorn/shared/run-types";
import { ERROR_CODE, LOCAL_ERROR_CODE } from "@acorn/shared/user-messages";

import { AgentApiError } from "./client";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";

/** The Now card's wording while the agent works and the person has not asked anything. */
export const AGENT_STARTING_MESSAGE = "Starting the agent…";

/** Said when Continue finds the agent has forgotten the run (it expired), so it starts over. */
export const AGENT_EXPIRED_MESSAGE = "The agent no longer remembers this run, so it starts over…";
export const AGENT_RESTORED_MESSAGE =
  "The agent was restarted. Acorn kept the job description, your résumé choice and its notes, and goes on from them…";

/** What the person is told for each way the agent server can refuse, as the shared catalogue names it. */
const SHARED_CODE: Record<string, string> = {
  [AGENT_ERROR_CODE.noKey]: ERROR_CODE.noKey,
  [AGENT_ERROR_CODE.invalidKey]: ERROR_CODE.invalidKey,
  [AGENT_ERROR_CODE.noCredits]: ERROR_CODE.noCredits,
  [AGENT_ERROR_CODE.rateLimited]: ERROR_CODE.rateLimited,
  [AGENT_ERROR_CODE.signedOut]: ERROR_CODE.signedOut,
  [AGENT_ERROR_CODE.modelError]: ERROR_CODE.providerDown,
  unreachable: LOCAL_ERROR_CODE.offline,
  timeout: LOCAL_ERROR_CODE.timeout,
};

/** The run state of an agent Run on one step. */
export function agentRunState(input: {
  runId: string;
  startedAt: number;
  step: number;
  control?: string;
  usage?: AgentUsage | null;
  /** The question the run is waiting on, while it waits. */
  ask?: AgentAsk;
  /** What the run is reading in Gmail for a code or link, while it does and once it has. */
  mail?: MailSearch;
  /** The page the run is on, for the minimap. */
  map?: RunMap;
}): RunProgress {
  return {
    runId: input.runId,
    stage: RUN_STAGE.filling,
    startedAt: input.startedAt,
    page: 1,
    step: input.step,
    refills: 0,
    maxRefills: 0,
    control: input.control,
    costUsd: input.usage?.cost,
    modelCalls: input.usage?.calls,
    screenChecks: input.usage?.checks,
    ask: input.ask,
    mail: input.mail,
    map: input.map,
  };
}

export function runningProgress(run: RunProgress, message: string): PipelineProgress {
  return { phase: "running", message, run };
}

/** A failure the person can read, from what the agent server or the page said. */
export function failureFromError(
  err: unknown,
  stage: RunFailure["stage"] = RUN_STAGE.filling,
): RunFailure {
  if (err instanceof AgentApiError) {
    const sharedCode = SHARED_CODE[err.code];
    return {
      reason: sharedCode ? RUN_FAILURE_REASON.aiUnavailable : RUN_FAILURE_REASON.noProgress,
      code: sharedCode,
      label: err.message,
      detail: err.message,
      stage,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { reason: RUN_FAILURE_REASON.noProgress, label: message, detail: message, stage };
}

/** What the agent said when it ended the run itself: needs the person, or cannot go on. */
export function failureFromStatus(
  status: string,
  message: string,
  stop?: AgentStop,
  stage: RunFailure["stage"] = RUN_STAGE.filling,
): RunFailure {
  const reason =
    status === AGENT_STATUS.needPerson
      ? RUN_FAILURE_REASON.waitedForPerson
      : RUN_FAILURE_REASON.noProgress;
  const label = stop?.problem || message || "The run stopped";
  return {
    reason,
    label,
    detail: stop?.action || (message !== label ? message : ""),
    stage,
    agentStop: stop
      ? { reason: stop.reason, problem: stop.problem || label, action: stop.action }
      : undefined,
  };
}

/** The words on the Now card when the run ends. */
export function endMessage(
  report: RunReport,
  steps: number,
  seconds: number,
  usage: AgentUsage | null,
): string {
  const cost = usage && usage.cost > 0 ? ` · ${formatUsd(usage.cost)}` : "";
  const took = `${steps} step${steps === 1 ? "" : "s"} · ${seconds}s${cost}`;
  switch (report.outcome) {
    case RUN_OUTCOME.stopped:
      return `Stopped by you · ${took}`;
    case RUN_OUTCOME.readyToSubmit:
      return `Ready to submit · ${took}`;
    case RUN_OUTCOME.failed:
      return `Stopped · ${report.failure?.label ?? "the run could not finish"}`;
    default:
      return `Done · ${took}`;
  }
}

/** The final progress of a run: its phase, message, and report. */
export function endProgress(input: {
  run: RunProgress;
  report: RunReport;
  steps: number;
  startedAt: number;
  usage: AgentUsage | null;
  /** The run's memory is kept on the server, so Continue can take it back up. */
  canContinue: boolean;
}): PipelineProgress {
  const { run, report, steps, startedAt, usage, canContinue } = input;
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const failed = report.outcome === RUN_OUTCOME.failed;
  return {
    phase: failed ? "error" : report.outcome === RUN_OUTCOME.stopped ? "idle" : "done",
    message: endMessage(report, steps, seconds, usage),
    error: failed
      ? [report.failure?.label, report.failure?.detail].filter(Boolean).join(": ")
      : undefined,
    durationMs: Date.now() - startedAt,
    run: {
      ...run,
      endedAt: Date.now(),
      report,
      canContinue,
    },
  };
}
