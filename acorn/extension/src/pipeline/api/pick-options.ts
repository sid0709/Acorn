import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";
import { LOG_KIND, logTab } from "../../tab-log-session";

import type { AiUsageSummary } from "@acorn/shared/ai-usage";

export type ChoiceItem = {
  id: number;
  field: string;
  intended: string;
  options: string[];
  multiple: boolean;
};

export type ChoicePick = { id: number; options: string[] };

/** One SelectorGateway (Jev) batch for many choice fields. Fails open with no picks. */
export async function requestChoicePicks(
  items: ChoiceItem[],
  apiUrl: string,
  tabId: number,
): Promise<{ picks: ChoicePick[]; usage?: AiUsageSummary }> {
  const base = (apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  logTab(tabId, LOG_KIND.aiRequest, "POST /acorn/pick-options", () => ({ items }));
  const res = await fetch(`${base}/acorn/pick-options`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify({ items }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    picks?: ChoicePick[];
    usage?: AiUsageSummary;
  };
  logTab(tabId, LOG_KIND.aiResponse, `pick-options ${res.status}`, () => data);
  if (!res.ok || !data.ok) return { picks: [] };
  return { picks: Array.isArray(data.picks) ? data.picks : [], usage: data.usage };
}
