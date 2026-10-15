import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  flaggedLabelsOf,
  forgetDeliveredAt,
  forgetDeliveredFiles,
  noteDeliveredFiles,
  scanWithoutDelivered,
  withoutDeliveredUploads,
} from "./delivered-files.ts";

import type { FieldIssue } from "@acorn/shared/field-issues";
import type { FormField } from "@acorn/shared/form-fields";
import type { PlanAction, RunStepRecord } from "@acorn/shared/plan-runner/types";

const TAB = 7;
const URL_A = "https://jobs.example/apply/candidate?x=1";
const LABEL = "Or please select your resume — My Computer (Opens new window)";

const upload = { action: "resume_upload", expected_label: LABEL } as PlanAction;
const fill = { action: "fill", expected_label: "First Name" } as PlanAction;
const ok = (index: number): RunStepRecord => ({
  index,
  action: "x",
  element_index: 1,
  expected_label: null,
  status: "ok",
});

const field = (over: Partial<FormField>): FormField =>
  ({ elementIndex: 1, kind: "file", label: LABEL, required: true, ...over }) as FormField;
const issue = (over: Partial<FieldIssue>): FieldIssue => ({
  elementIndex: 1,
  label: "My Computer (Opens new window)",
  role: "file",
  value: "",
  required: true,
  invalid: false,
  linkedMessages: [],
  nearbyMessages: [],
  ...over,
});

describe("delivered files", () => {
  beforeEach(() => forgetDeliveredFiles(TAB));

  it("drops an upload the page already took, keeps the rest", () => {
    noteDeliveredFiles(TAB, URL_A, [upload, fill], [ok(0), ok(1)]);
    // The page drew itself again: same address, another query, the field's label unchanged.
    const kept = withoutDeliveredUploads(
      TAB,
      "https://jobs.example/apply/candidate?x=2",
      [upload, fill],
      new Set(),
    );
    assert.deepEqual(kept, [fill]);
  });

  it("asks again for a field the page flags", () => {
    noteDeliveredFiles(TAB, URL_A, [upload], [ok(0)]);
    const flagged = flaggedLabelsOf([field({})], {
      issues: [issue({ invalid: true })],
      pageMessages: [],
    });
    assert.deepEqual(withoutDeliveredUploads(TAB, URL_A, [upload], flagged), [upload]);
  });

  it("does not remember an upload that failed, or one at another address", () => {
    noteDeliveredFiles(TAB, URL_A, [upload], [{ ...ok(0), status: "failed" }]);
    assert.deepEqual(withoutDeliveredUploads(TAB, URL_A, [upload], new Set()), [upload]);
    noteDeliveredFiles(TAB, URL_A, [upload], [ok(0)]);
    assert.deepEqual(
      withoutDeliveredUploads(TAB, "https://jobs.example/other", [upload], new Set()),
      [upload],
    );
  });

  it("forgets a step the application moved on from", () => {
    noteDeliveredFiles(TAB, URL_A, [upload], [ok(0)]);
    forgetDeliveredAt(TAB, URL_A);
    assert.deepEqual(withoutDeliveredUploads(TAB, URL_A, [upload], new Set()), [upload]);
  });

  it("does not count a delivered file input as required and empty", () => {
    noteDeliveredFiles(TAB, URL_A, [upload], [ok(0)]);
    const scan = { issues: [issue({})], pageMessages: [] };
    assert.equal(scanWithoutDelivered(TAB, URL_A, scan, [field({})]).issues.length, 0);
    const other = [field({ elementIndex: 2, label: "Cover letter" })];
    assert.equal(scanWithoutDelivered(TAB, URL_A, scan, other).issues.length, 1);
  });
});
