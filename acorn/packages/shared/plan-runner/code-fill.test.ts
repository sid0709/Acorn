import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planCodeFill, spreadCodeAcrossBoxes } from "./code-fill.ts";

import type { FormField } from "../form-fields.ts";

const box = (elementIndex: number, extra: Partial<FormField> = {}): FormField => ({
  elementIndex,
  kind: "text",
  label: `box ${elementIndex}`,
  required: true,
  ...extra,
});

describe("planCodeFill", () => {
  it("types the code into the boxes the page waits on when the whole form is on screen", () => {
    const form = [
      box(1, { label: "First name" }),
      box(2, { label: "Last name" }),
      ...[10, 11, 12, 13, 14, 15, 16, 17].map((i) => box(i, { blocking: true })),
    ];
    const plan = planCodeFill(form, "ABCD1234");
    assert.deepEqual(
      plan?.map((a) => [a.element_index, a.value]),
      [
        [10, "A"],
        [11, "B"],
        [12, "C"],
        [13, "D"],
        [14, "1"],
        [15, "2"],
        [16, "3"],
        [17, "4"],
      ],
    );
  });

  it("types a whole code into the single box the page waits on", () => {
    const plan = planCodeFill([box(1), box(2), box(3, { blocking: true })], "123456");
    assert.deepEqual(
      plan?.map((a) => [a.element_index, a.value]),
      [[3, "123456"]],
    );
  });

  it("gives one box the whole code", () => {
    const plan = planCodeFill([box(1)], "123456");
    assert.deepEqual(
      plan?.map((a) => a.value),
      ["123456"],
    );
  });

  it("gives one character to each of as many boxes as the code has", () => {
    const plan = planCodeFill(
      [1, 2, 3, 4, 5, 6].map((i) => box(i)),
      "516851",
    );
    assert.deepEqual(
      plan?.map((a) => [a.element_index, a.value]),
      [
        [1, "5"],
        [2, "1"],
        [3, "6"],
        [4, "8"],
        [5, "5"],
        [6, "1"],
      ],
    );
  });

  it("leaves the page to the planner when it asks for more than the code", () => {
    assert.equal(planCodeFill([box(1), box(2)], "123456"), null);
  });

  it("ignores optional boxes and non-text fields", () => {
    const fields = [box(1), box(2, { required: false }), box(3, { kind: "checkbox" })];
    assert.equal(planCodeFill(fields, "123456")?.length, 1);
  });

  it("leaves a box too short for the code to the planner", () => {
    assert.equal(planCodeFill([box(1, { maxLength: 1 })], "123456"), null);
  });
});

describe("spreadCodeAcrossBoxes", () => {
  it("hands each box its own character when every box got the whole code", () => {
    const actions = Array.from({ length: 4 }, () => ({ action: "fill", value: "9876" }));
    spreadCodeAcrossBoxes(actions, "9876");
    assert.deepEqual(
      actions.map((a) => a.value),
      ["9", "8", "7", "6"],
    );
  });

  it("leaves a single box and unrelated plans alone", () => {
    const one = [{ action: "fill", value: "9876" }];
    spreadCodeAcrossBoxes(one, "9876");
    assert.equal(one[0].value, "9876");
    const other = [
      { action: "fill", value: "a" },
      { action: "fill", value: "b" },
    ];
    spreadCodeAcrossBoxes(other, "9876");
    assert.deepEqual(
      other.map((a) => a.value),
      ["a", "b"],
    );
  });
});
