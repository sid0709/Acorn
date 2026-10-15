import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { codeLabelsOf, codeRefused } from "./run-code";

import type { FieldIssue } from "@acorn/shared/field-issues";

const issue = (label: string, over: Partial<FieldIssue> = {}): FieldIssue => ({
  elementIndex: 1,
  label,
  role: "textbox",
  value: "",
  required: false,
  invalid: false,
  linkedMessages: [],
  nearbyMessages: [],
  ...over,
});

describe("code boxes", () => {
  it("records the fill steps that carried the code", () => {
    const labels = codeLabelsOf(
      [
        { action: "fill", value: "Stanley", expected_label: "First Name" },
        { action: "fill", value: "a", expected_label: "Security code" },
        { action: "fill", value: "b", expected_label: "Digit 2" },
        { action: "select_radio", value: "a", expected_label: "Pick" },
      ],
      "ab12",
    );
    assert.deepEqual(labels.sort(), ["digit 2", "security code"]);
  });

  it("is refused only when a code box is flagged", () => {
    const scan = { issues: [issue("I Accept", { invalid: true })], pageMessages: [] };
    assert.equal(codeRefused(["security code"], scan), false);
    const refused = { issues: [issue("Security code", { invalid: true })], pageMessages: [] };
    assert.equal(codeRefused(["security code"], refused), true);
  });

  it("keeps the old reading when the boxes are unknown", () => {
    assert.equal(codeRefused([], { issues: [], pageMessages: [] }), true);
  });
});
