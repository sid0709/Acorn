import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { annotateGroups } from "./groups.ts";

import type { FormField } from "../form-fields.ts";

const field = (elementIndex: number, group?: string): FormField => ({
  elementIndex,
  kind: "radio",
  label: "q",
  required: true,
  group,
});

describe("annotateGroups", () => {
  it("puts each choice field's group on the actions that target it", () => {
    const actions = [
      {
        element_index: 129 as number | null,
        expected_group: undefined as string | null | undefined,
      },
      {
        element_index: 141 as number | null,
        expected_group: undefined as string | null | undefined,
      },
      { element_index: 5 as number | null, expected_group: undefined as string | null | undefined },
    ];
    annotateGroups(actions, [field(129, "radio::q1"), field(141, "radio::q2"), field(5)]);
    assert.deepEqual(
      actions.map((action) => action.expected_group),
      ["radio::q1", "radio::q2", undefined],
    );
  });

  it("leaves actions alone when there is no field list", () => {
    const actions = [{ element_index: 1 as number | null }];
    annotateGroups(actions, undefined);
    assert.deepEqual(actions, [{ element_index: 1 }]);
  });
});
