import type { DomNode } from "../types";
import type { PauseRequest, RunReport } from "@acorn/shared/plan-runner/types";

export function shortLabel(expectedLabel: string | null | undefined, action: string): string {
  const label = (expectedLabel || "").trim();
  if (!label) return action;
  return label.length > 36 ? `${label.slice(0, 33)}…` : label;
}

/**
 * Unattended pause policy for FAB pipeline:
 * - errors → always skip
 * - planned pause → continue so autofill can run when a value is present
 */
export async function autoPauseDecision(request: PauseRequest) {
  if (request.kind === "error") return "skip" as const;
  return "continue" as const;
}

export function countDomNodes(node: DomNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countDomNodes(child), 0);
}

/** One report for a run in two passes; the late pass's steps follow the first pass's. */
export function mergeReports(first: RunReport, late: RunReport): RunReport {
  const offset = first.steps.length;
  const summary = { ...first.summary };
  for (const key of Object.keys(summary) as (keyof RunReport["summary"])[]) {
    summary[key] += late.summary[key];
  }
  return {
    ok: first.ok && late.ok,
    aborted: first.aborted || late.aborted,
    steps: [...first.steps, ...late.steps.map((step) => ({ ...step, index: step.index + offset }))],
    summary,
  };
}
