import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countFlaggedSince,
  countNotedSince,
  type FieldIssue,
  type FieldIssueScan,
} from "./field-issues.ts";

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

describe("countNotedSince", () => {
  const phone = issue({ label: "Phone Number *", role: "textbox", value: "(424) 320-7354" });
  const help = issue({ label: "Bio", role: "textbox", nearbyMessages: ["Max 500 characters"] });

  it("counts plain text that appeared beside a field after the fill", () => {
    const rejected = { ...phone, nearbyMessages: ["Please, enter a valid phone number"] };
    assert.equal(countNotedSince(scan(help), scan(help, rejected)), 1);
  });

  it("ignores help text the page showed before the fill", () => {
    assert.equal(countNotedSince(scan(help), scan(help)), 0);
  });

  it("leaves fields with a hard signal to countFlaggedSince", () => {
    const flagged = { ...phone, invalid: true, nearbyMessages: ["Invalid"] };
    assert.equal(countNotedSince(scan(), scan(flagged)), 0);
  });
});
