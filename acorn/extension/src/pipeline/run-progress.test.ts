import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProgressLedger, pageNeeds } from "./run-progress.ts";

import type { FieldIssue, FieldIssueScan } from "@acorn/shared/field-issues";

function issue(label: string, patch: Partial<FieldIssue> = {}): FieldIssue {
  return {
    elementIndex: 1,
    label,
    role: "textbox",
    value: "",
    required: false,
    invalid: false,
    linkedMessages: [],
    nearbyMessages: [],
    ...patch,
  };
}

function scan(...issues: FieldIssue[]): FieldIssueScan {
  return { issues, pageMessages: ["Please review your application"] };
}

describe("pageNeeds", () => {
  it("names flagged fields, empty required fields, and the requirement", () => {
    const needs = pageNeeds(
      scan(
        issue("Phone Number", { invalid: true, value: "4243207354" }),
        issue("Degree", { required: true }),
        issue("Middle Name"),
        issue("Address Line 2", { nearbyMessages: ["Optional"] }),
      ),
      "Add Education",
    );
    assert.deepEqual(needs, ["Phone Number", "Degree", "Add Education"]);
  });

  it("leaves out answered required fields and page notices", () => {
    assert.deepEqual(pageNeeds(scan(issue("Email", { required: true, value: "a@b.c" }))), []);
  });
});

describe("ProgressLedger", () => {
  const address = "jobs.example/apply/section/1/";

  it("counts rounds that settle nothing the page needed", () => {
    const ledger = new ProgressLedger();
    assert.equal(ledger.note(address, ["Phone Number", "Add Education"]), 0);
    assert.equal(ledger.note(address, ["Add Education", "Phone Number"]), 1);
    assert.equal(ledger.note(address, ["Phone Number", "Add Education", "Degree"]), 2);
  });

  it("starts over once anything is settled", () => {
    const ledger = new ProgressLedger();
    ledger.note(address, ["Phone Number", "Add Education"]);
    ledger.note(address, ["Phone Number", "Add Education"]);
    assert.equal(ledger.note(address, ["Add Experience", "Phone Number"]), 0);
  });

  it("never stalls on a page that needs nothing, or newly needs something", () => {
    const ledger = new ProgressLedger();
    assert.equal(ledger.note(address, []), 0);
    assert.equal(ledger.note(address, []), 0);
    assert.equal(ledger.note(address, ["Phone Number"]), 0);
  });

  it("keeps each address apart", () => {
    const ledger = new ProgressLedger();
    ledger.note(address, ["Phone Number"]);
    assert.equal(ledger.note("jobs.example/apply/section/2/", ["Phone Number"]), 0);
  });

  it("starts over on a new step at the same address", () => {
    const ledger = new ProgressLedger();
    ledger.note(address, ["Middle Name"]);
    ledger.forget(address);
    assert.equal(ledger.note(address, ["Middle Name"]), 0);
  });
});
