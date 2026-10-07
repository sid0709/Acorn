import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countFlaggedSince, type FieldIssue, type FieldIssueScan } from "./field-issues.ts";

function issue(overrides: Partial<FieldIssue>): FieldIssue {
  return {
    elementIndex: 1,
    label: "Pronouns",
    role: "combobox",
    value: "",
    required: false,
    invalid: false,
    linkedMessages: [],
    nearbyMessages: [],
    ...overrides,
  };
}

function scan(...issues: FieldIssue[]): FieldIssueScan {
  return { issues, pageMessages: [] };
}

describe("countFlaggedSince", () => {
  const hint = issue({ linkedMessages: ["Add pronouns so interviewers know how to refer to you"] });

  it("ignores a hint the page linked before the click", () => {
    assert.equal(countFlaggedSince(scan(hint), scan(hint)), 0);
  });

  it("counts a message the click revealed", () => {
    const error = issue({ label: "Email", linkedMessages: ["Enter a valid email"] });
    assert.equal(countFlaggedSince(scan(hint), scan(hint, error)), 1);
  });

  it("always counts a field marked invalid", () => {
    const invalid = issue({ label: "Why us?", invalid: true });
    assert.equal(countFlaggedSince(scan(invalid), scan(invalid)), 1);
  });

  it("counts every linked message with no earlier scan", () => {
    assert.equal(countFlaggedSince(null, scan(hint)), 1);
  });
});
