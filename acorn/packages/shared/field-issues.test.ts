import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countFlaggedSince,
  countNotedSince,
  flaggedFields,
  type FieldIssue,
  type FieldIssueScan,
} from "./field-issues.ts";

import type { FormField } from "./form-fields.ts";

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

describe("flaggedFields", () => {
  const field = (elementIndex: number, label: string): FormField => ({
    elementIndex,
    kind: "text",
    label,
    required: false,
  });
  const email = field(4, "Email");
  const phone = field(6, "Phone");
  // A field answers the issues named by its own id, or by any id it lists here.
  const owns: Record<number, number[]> = { 4: [4], 6: [6, 7] };
  const answers = (f: FormField, i: FieldIssue) =>
    Boolean(owns[f.elementIndex]?.includes(i.elementIndex));

  it("keeps only the fields an issue names, with what the page shows about each", () => {
    const missing = issue({ elementIndex: 4, label: "Email", required: true, invalid: true });
    const [only, ...rest] = flaggedFields([email, phone], scan(missing), answers);
    assert.equal(rest.length, 0);
    assert.deepEqual(only.issue, {
      elementIndexes: [4],
      value: "",
      invalid: true,
      linkedMessages: [],
      nearbyMessages: [],
    });
  });

  it("gathers every issue one field answers into one note", () => {
    const shown = issue({
      elementIndex: 6,
      value: "4243207354",
      linkedMessages: ["Invalid number"],
    });
    const box = issue({ elementIndex: 7, nearbyMessages: ["Invalid number", "Use digits"] });
    const [only] = flaggedFields([email, phone], scan(shown, box), answers);
    assert.equal(only.elementIndex, 6);
    assert.deepEqual(only.issue?.elementIndexes, [6, 7]);
    assert.equal(only.issue?.value, "4243207354");
    assert.deepEqual(only.issue?.nearbyMessages, ["Invalid number", "Use digits"]);
  });

  it("lists no field for an issue no field answers", () => {
    const dropdown = issue({ elementIndex: 12, role: "combobox", required: true });
    assert.deepEqual(flaggedFields([email, phone], scan(dropdown), answers), []);
  });
});
