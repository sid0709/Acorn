import { RUN_EVIDENCE_LINE_MAX_CHARS, RUN_EVIDENCE_MAX_LINES } from "./run-limits";

import type { RunStepRecord } from "@acorn/shared/plan-runner/types";
import type { PageSnapshot } from "./run-page";

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > RUN_EVIDENCE_LINE_MAX_CHARS
    ? `${line.slice(0, RUN_EVIDENCE_LINE_MAX_CHARS - 1)}…`
    : line;
}

/**
 * What the page and the fill say went wrong, as short lines for the diagnosis:
 * page alerts, each flagged field with the message tied to it, and steps that
 * failed. Field values are never included.
 */
export function failureEvidence(args: {
  snapshot: PageSnapshot | null;
  steps?: RunStepRecord[];
  notes?: string[];
}): string[] {
  const lines: string[] = [...(args.notes ?? [])];
  const scan = args.snapshot?.scan;
  for (const message of scan?.pageMessages ?? []) lines.push(`Page alert: ${message}`);
  for (const issue of scan?.issues ?? []) {
    const messages = [...issue.linkedMessages, ...issue.nearbyMessages].join(" / ");
    const state = issue.invalid ? "invalid" : issue.required ? "required" : "flagged";
    lines.push(
      `Field "${issue.label || issue.role}" is ${state}${messages ? `: ${messages}` : ""}`,
    );
  }
  for (const step of args.steps ?? []) {
    if (step.status === "failed" || step.status === "blocked") {
      lines.push(
        `Step ${step.action} on "${step.expected_label ?? "?"}" ${step.status}${step.message ? `: ${step.message}` : ""}`,
      );
    }
  }
  return lines.map(clip).filter(Boolean).slice(0, RUN_EVIDENCE_MAX_LINES);
}
