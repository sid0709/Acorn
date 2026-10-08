import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FILL_MODE } from "./field-issues.ts";
import { MAX_PLAN_TURNS, appendPlanTurn, type PlanTurn } from "./plan-history.ts";

function turn(goal: string): PlanTurn {
  return {
    mode: FILL_MODE.refill,
    plan: {
      goal,
      actions: [],
      forbidden_actions: [],
      validation: { required_element_indexes: [], stop_before_submit: true },
      unresolved_items: [],
    },
    steps: [],
  };
}

describe("appendPlanTurn", () => {
  it("keeps every turn under the cap", () => {
    assert.deepEqual(
      appendPlanTurn([turn("fill")], turn("refill 1")).map((t) => t.plan.goal),
      ["fill", "refill 1"],
    );
  });

  it("keeps the page's fill and the latest turns past the cap", () => {
    let turns: PlanTurn[] = [];
    for (let i = 0; i <= MAX_PLAN_TURNS; i += 1) turns = appendPlanTurn(turns, turn(`t${i}`));
    assert.equal(turns.length, MAX_PLAN_TURNS);
    assert.equal(turns[0].plan.goal, "t0");
    assert.equal(turns.at(-1)?.plan.goal, `t${MAX_PLAN_TURNS}`);
  });
});
