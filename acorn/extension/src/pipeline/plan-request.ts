import { FILL_MODE } from "@acorn/shared/field-issues";
import { FAST_PLAN_MODE, type FormField } from "@acorn/shared/form-fields";

import { traceFromBackground } from "../background/debug-trace-sink";

import { requestAiAnalyze, type AiAnalyzeRequest, type AiAnalyzeResponse } from "./api/analyze";

/**
 * Fill plans with the decision model first (Jev classifies and picks; the text
 * model only writes prose). Any failure falls back to the text-model planner.
 */
export const FAST_FILL_ENABLED = true;

/** Whether this run should collect the page's field list for the fast planner. */
export function wantsFastPlan(mode: AiAnalyzeRequest["mode"]): boolean {
  return FAST_FILL_ENABLED && (mode ?? FILL_MODE.fill) === FILL_MODE.fill;
}

/** The plan for this run: fast when it can be, the full planner otherwise. */
export async function requestPlan(
  request: AiAnalyzeRequest,
  formFields: FormField[] | undefined,
  apiUrl: string,
  tabId: number,
): Promise<AiAnalyzeResponse> {
  if (wantsFastPlan(request.mode) && formFields?.length) {
    const started = Date.now();
    try {
      const fast = await requestAiAnalyze(
        { ...request, mode: FAST_PLAN_MODE, formFields },
        apiUrl,
        tabId,
      );
      if (fast.mode === FAST_PLAN_MODE && fast.plan?.actions?.length) {
        traceFromBackground("plan:fast", () => ({
          fields: formFields.length,
          actions: fast.plan?.actions.length,
          ms: Date.now() - started,
        }));
        return fast;
      }
      traceFromBackground("plan:fast-empty", () => ({ fields: formFields.length }));
    } catch (err) {
      traceFromBackground("plan:fast-failed", () => ({
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }
  return requestAiAnalyze(request, apiUrl, tabId);
}
