import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attemptsByField,
  describeNeeds,
  fieldKey,
  requiredUnanswerable,
  withAttempts,
  type PlanTurn,
} from "./plan-history.ts";

import type { FormField } from "./form-fields.ts";
import type { PlanAction } from "./plan-runner/types.ts";
import type { RunStepStatus } from "./plan-runner/types.ts";

const action = (label: string, value: string, group?: string): PlanAction => ({
  action: "select_radio",
  element_index: 1,
  element_indexes: null,
  expected_label: label,
  expected_role: "radio",
  value,
  file: null,
  reason: null,
  ms: null,
  expected_group: group,
});

const turn = (
  actions: PlanAction[],
  statuses: RunStepStatus[],
  messages: string[] = [],
): PlanTurn => ({
  mode: "refill",
  plan: {
    goal: "",
    actions,
    forbidden_actions: [],
    validation: { required_element_indexes: [], stop_before_submit: true },
    unresolved_items: [],
  },
  steps: actions.map((a, index) => ({
    index,
    action: a.action,
    element_index: a.element_index,
    expected_label: a.expected_label,
    status: statuses[index],
    message: messages[index],
  })),
});

const flagged = (label: string, group?: string): FormField => ({
  elementIndex: 9,
  kind: "radio",
  label,
  required: true,
  group,
  issue: { elementIndexes: [9], value: "", invalid: true },
});

describe("fieldKey", () => {
  it("is the choice group when there is one, so two questions worded alike stay apart", () => {
    assert.notEqual(
      fieldKey({ group: "radio::a", label: "✱" }),
      fieldKey({ group: "radio::b", label: "✱" }),
    );
    assert.equal(fieldKey({ label: "  Phone  " }), fieldKey({ label: "phone" }));
  });
});

describe("withAttempts", () => {
  it("tells each flagged field what earlier rounds answered it and how the step went", () => {
    const turns = [
      turn([action("Q2", "Yes", "radio::q2")], ["ok"]),
      turn(
        [action("Q2", "No", "radio::q2"), action("Q1", "Yes", "radio::q1")],
        ["ok", "ok"],
        ["", ""],
      ),
    ];
    const [q2] = withAttempts([flagged("Q2", "radio::q2")], turns) ?? [];
    assert.deepEqual(q2.issue?.attempts, [
      { value: "Yes", result: "ok" },
      { value: "No", result: "ok" },
    ]);
  });

  it("leaves a field no step touched alone, and keeps the failure a step reported", () => {
    const turns = [
      turn([action("Q1", "Yes", "radio::q1")], ["failed"], ["Resolved to another question"]),
    ];
    const [fresh] = withAttempts([flagged("Q9", "radio::q9")], turns) ?? [];
    assert.equal(fresh.issue?.attempts, undefined);
    assert.deepEqual(attemptsByField(turns).get(fieldKey({ group: "radio::q1", label: "Q1" })), [
      { value: "Yes", result: "failed: Resolved to another question" },
    ]);
  });

  it("does not count the page's first fill as an attempt to fix the field", () => {
    const first: PlanTurn = { ...turn([action("Q2", "Yes", "radio::q2")], ["ok"]), mode: "fill" };
    const [q2] = withAttempts([flagged("Q2", "radio::q2")], [first]) ?? [];
    assert.equal(q2.issue?.attempts, undefined);
  });

  it("sends the fields as they are when nothing was tried", () => {
    const fields = [flagged("Q", "radio::q")];
    assert.deepEqual(withAttempts(fields, []), fields);
    assert.equal(withAttempts(undefined, []), undefined);
  });
});

describe("describeNeeds", () => {
  it("names what was tried on each field the run gives up on", () => {
    const turns = [turn([action("Q2", "Yes"), action("Q2", "No")], ["ok", "ok"])];
    assert.deepEqual(describeNeeds(["Q2", "Q9"], turns), [
      'Q2 (tried "Yes", then "No"; the page still flags it)',
      "Q9",
    ]);
  });
});

describe("requiredUnanswerable", () => {
  it("lists the required fields the page's fill could not answer", () => {
    const fill: PlanTurn = turn([action("Q", "x")], ["ok"]);
    fill.mode = "fill";
    fill.plan.unanswerable = [{ element_index: 9, label: "cards[x][field9]", reason: "unread" }];
    assert.deepEqual(requiredUnanswerable([fill]), ["cards[x][field9]"]);
    const refill = turn([action("Q", "x")], ["ok"]);
    refill.plan.unanswerable = [{ element_index: 2, label: "other", reason: "unread" }];
    assert.deepEqual(requiredUnanswerable([refill]), []);
  });
});
