import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";

import { loggedFetch } from "./api-log";
import { apiError } from "./http";

import type { AiUsageSummary } from "@acorn/shared/ai-usage";
import type { FieldIssueScan, FillMode } from "@acorn/shared/field-issues";
import type { FAST_PLAN_MODE, FormField } from "@acorn/shared/form-fields";
import type { PlanTurn } from "@acorn/shared/plan-history";
import type { ActionPlan } from "@acorn/shared/plan-runner/types";

export interface AiAnalyzePage {
  title?: string;
  url?: string;
  fetchedAt?: string;
  job?: {
    id: string;
    title: string;
    company: string;
  } | null;
  customGenerationId?: string | null;
  customLibraryResumeId?: string | null;
  customRemembered?: boolean;
  recommendedResumeAvailable?: boolean;
  recommendedResumeStack?: string | null;
}

export interface AiAnalyzeRequest {
  /** Sole tree the planner reads; control attrs ride on each node's `detail`. */
  pureTree: string;
  /** Refill plans fixes for `fieldIssues` only; fast plans from `formFields`; Fill (default) plans every field. */
  mode?: FillMode | typeof FAST_PLAN_MODE;
  fieldIssues?: FieldIssueScan;
  /** Refill only: the plans already run on this page, so the planner continues its own conversation. */
  history?: PlanTurn[];
  /** Fast plans read these; a Refill sends the flagged fields, planned on their own first. */
  formFields?: FormField[];
  page?: AiAnalyzePage | null;
  /** A code the run found in the applicant's mail; the planner fills it, no model reads it. */
  verificationCode?: string;
}

export interface AiAnalyzeResponse {
  ok?: boolean;
  plan?: ActionPlan;
  model?: string;
  responseId?: string | null;
  error?: string;
  usage?: AiUsageSummary;
  /** Echoed by a backend that planned a Refill or a fast plan; absent on a full Fill plan. */
  mode?: FillMode | typeof FAST_PLAN_MODE;
  /** Which planner planned a Refill: the per-field fast planner, or the conversation. */
  refillPlanner?: string;
}

export async function requestAiAnalyze(
  payload: AiAnalyzeRequest,
  _apiUrl?: string,
  tabId?: number | null,
): Promise<AiAnalyzeResponse> {
  const base = (_apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  const res = await loggedFetch(
    tabId,
    `ai-analyze · ${payload.mode ?? "fill"}`,
    `${base}/acorn/ai-analyze`,
    {
      method: "POST",
      headers: await authHeaders(tabId),
      body: JSON.stringify(payload),
    },
    {
      // The tree and the plan each have an entry of their own.
      shapeRequest: (request) => ({
        ...(request as object),
        pureTree: `(${payload.pureTree.length} characters, see the Compressed tree entry)`,
      }),
      shapeResponse: (body) => {
        const answer = body as { plan?: { actions?: unknown[] } };
        return answer?.plan
          ? {
              ...answer,
              plan: `(${answer.plan.actions?.length ?? 0} actions, see the Action plan entry)`,
            }
          : body;
      },
    },
  );

  const data = (await res.json().catch(() => ({}))) as AiAnalyzeResponse & {
    message?: string;
    success?: boolean;
  };
  if (!res.ok) throw apiError(res, data, `AI analyze failed: ${res.status}`);
  if (!data.plan) throw apiError(res, data, "AI backend returned no plan");
  return data;
}
