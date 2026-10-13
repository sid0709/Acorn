import { FAST_PLAN_MODE } from "@acorn/shared/form-fields";
import { applyApplicantIdentityToActions } from "@acorn/shared/plan-runner/applicant-identity";
import { formatPlannerTree } from "@acorn/shared/planner-tree";

import { traceFromBackground } from "../background/debug-trace-sink";

import { requestAiAnalyze, type AiAnalyzeRequest } from "./api/analyze";
import { fetchDomFromTab } from "./fetch-dom";

import type { ActionPlan } from "@acorn/shared/plan-runner/types";

/**
 * A question by its wording: the page numbers its nodes afresh on every read, and
 * a question an answer revealed shifts the numbers of all after it.
 */
export function lateFieldKey(label: string | null | undefined): string {
  return (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * After the plan ran, look at the page once more: a section that rendered after
 * the first scan, fields an import re-rendered, or follow-up questions an answer
 * revealed. Only fields still unanswered and untouched are planned, with the fast
 * planner alone — a full replan would rewrite what the first pass filled.
 */
export async function planLateFields(args: {
  tabId: number;
  frameId: number | null;
  page: AiAnalyzeRequest["page"];
  apiUrl: string;
  /** The page holds its forward control disabled: boxes left off are asked about again. */
  blocked?: boolean;
  /**
   * Questions an earlier look already planned or left, by `lateFieldKey`: only new
   * ones are planned, so looking again until nothing new shows costs nothing once
   * the page settled. Each field planned here is added to it.
   */
  seen?: Set<string>;
}): Promise<ActionPlan | null> {
  const { tabId, frameId, page, apiUrl, blocked = false, seen } = args;
  const started = Date.now();
  try {
    const dom = await fetchDomFromTab(tabId, frameId, {
      formFields: true,
      pendingFields: true,
      blockedFields: blocked,
    });
    const fields = (dom.formFields ?? []).filter((field) => !seen?.has(lateFieldKey(field.label)));
    for (const field of fields) seen?.add(lateFieldKey(field.label));
    traceFromBackground(
      "late:fields",
      () => ({
        count: fields.length,
        fields: fields.map((field) => ({
          i: field.elementIndex,
          kind: field.kind,
          label: field.label,
        })),
      }),
      tabId,
    );
    if (!fields.length) return null;
    const res = await requestAiAnalyze(
      { pureTree: formatPlannerTree(dom.tree), mode: FAST_PLAN_MODE, formFields: fields, page },
      apiUrl,
      tabId,
    );
    const plan = res.mode === FAST_PLAN_MODE ? res.plan : undefined;
    traceFromBackground(
      "late:plan",
      () => ({
        actions: plan?.actions?.length ?? 0,
        ms: Date.now() - started,
      }),
      tabId,
    );
    if (!plan?.actions?.length) return null;
    applyApplicantIdentityToActions(plan.actions);
    return plan;
  } catch (err) {
    traceFromBackground(
      "late:failed",
      () => ({
        error: err instanceof Error ? err.message : String(err),
      }),
      tabId,
    );
    return null;
  }
}
