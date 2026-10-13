import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";
import { LOG_KIND, logTab } from "../../tab-log-session";

import { extractError } from "./http";

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
  formFields?: FormField[];
  page?: AiAnalyzePage | null;
  /** Debug builds only: saved by a backend running with ACORN_DEBUG_DIR, never sent to the model. */
  debug?: { html?: string; domTree?: unknown; metaTree?: string };
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
}

export async function requestAiAnalyze(
  payload: AiAnalyzeRequest,
  _apiUrl?: string,
  tabId?: number | null,
): Promise<AiAnalyzeResponse> {
  const base = (_apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  const startedAt = Date.now();
  const tabKey = tabId ?? undefined;
  // The trees ride in their own entries; the page's HTML and the one-time code stay out.
  logTab(tabKey, LOG_KIND.aiRequest, `POST /acorn/ai-analyze · ${payload.mode ?? "fill"}`, () => ({
    ...payload,
    pureTree: `(${payload.pureTree.length} characters, see the Pure tree entry)`,
    debug: payload.debug ? "(page capture, not sent to the model)" : undefined,
    verificationCode: payload.verificationCode ? "(hidden)" : undefined,
  }));
  const res = await fetch(`${base}/acorn/ai-analyze`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as AiAnalyzeResponse & {
    message?: string;
    success?: boolean;
  };
  const ms = Date.now() - startedAt;
  if (!res.ok || !data.plan) {
    logTab(tabKey, LOG_KIND.aiResponse, `ai-analyze failed · ${res.status} · ${ms} ms`, () => data);
    if (!res.ok) throw new Error(extractError(data, `AI analyze failed: ${res.status}`));
    throw new Error(extractError(data, "AI backend returned no plan"));
  }
  logTab(tabKey, LOG_KIND.aiResponse, `ai-analyze ${res.status} · ${ms} ms`, () => ({
    ...data,
    plan: `(${data.plan?.actions?.length ?? 0} actions, see the Action plan entry)`,
  }));
  return data;
}
