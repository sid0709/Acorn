import { traceFromBackground } from "../background/debug-trace-sink";
import { sendTabMessage } from "../tab-messaging";
import { MSG } from "../types";

import { requestChoicePicks, type ChoiceItem } from "./api/pick-options";

import type { ActionPlan } from "@acorn/shared/plan-runner/types";

/** Steps whose value names an option the page may list. */
const CHOICE_ACTIONS = new Set(["fill", "select_radio"]);

/**
 * After uploads finish: decide every planned choice field whose options are in
 * the page, in one Jev batch, and rewrite those steps to the exact labels. Each
 * step then clicks without its own decision. Fails open: an undecided step still
 * decides alone when it runs.
 */
export async function decideChoicesInBatch(args: {
  tabId: number;
  frameId: number | null;
  plan: ActionPlan;
  apiUrl: string;
}): Promise<void> {
  const { tabId, frameId, plan, apiUrl } = args;
  const actions = plan.actions ?? [];
  const steps = actions
    .map((action, index) => ({ action, index }))
    .filter(
      ({ action }) =>
        CHOICE_ACTIONS.has(action.action) &&
        action.element_index != null &&
        typeof action.value === "string" &&
        action.value.trim(),
    )
    .map(({ action, index }) => ({
      index,
      element_index: action.element_index as number,
      expected_label: action.expected_label,
      value: action.value as string,
    }));
  if (!steps.length) return;

  const started = Date.now();
  const collected = await sendTabMessage<{ ok?: boolean; items?: ChoiceItem[] }>(
    tabId,
    { type: MSG.COLLECT_CHOICES, steps },
    frameId ?? undefined,
  );
  const items = collected?.ok && Array.isArray(collected.items) ? collected.items : [];
  if (!items.length) return;

  const { picks } = await requestChoicePicks(items, apiUrl, tabId).catch(() => ({ picks: [] }));
  for (const pick of picks) {
    const action = actions[pick.id];
    if (action && pick.options.length) action.value = pick.options.join(", ");
  }
  traceFromBackground("choices:batch", () => ({
    asked: items.length,
    decided: picks.length,
    ms: Date.now() - started,
    picks: picks.map((pick) => ({ step: pick.id, options: pick.options })),
  }));
}
