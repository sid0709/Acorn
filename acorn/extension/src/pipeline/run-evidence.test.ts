import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { failureEvidence } from "./run-evidence.ts";
import { RUN_EVIDENCE_MAX_LINES } from "./run-limits.ts";

import type { PageSnapshot } from "./run-page.ts";

function snapshot(issues: number, frames: string[]): PageSnapshot {
  return {
    tabId: 1,
    url: "",
    title: "",
    frameId: null,
    text: "",
    controls: [],
    flagged: issues,
    signature: "",
    fields: issues,
    frames,
    scan: {
      pageMessages: [],
      issues: Array.from({ length: issues }, (_, i) => ({
        elementIndex: i + 1,
        label: `Question ${i + 1}`,
        role: "radio",
        value: "",
        required: true,
        invalid: true,
        linkedMessages: ["Please select one of these options."],
        nearbyMessages: [],
      })),
    },
  };
}

describe("failureEvidence", () => {
  it("puts the page's field messages before the frames it embeds", () => {
    const lines = failureEvidence({ snapshot: snapshot(1, ["verify.example/widget"]) });
    assert.match(lines[0], /^Field "Question 1" is marked invalid/);
    assert.match(lines.at(-1) ?? "", /^Embedded frame:/);
  });

  it("keeps the frames under the cap however many fields are flagged", () => {
    const lines = failureEvidence({ snapshot: snapshot(50, ["verify.example/widget"]) });
    assert.equal(lines.length, RUN_EVIDENCE_MAX_LINES);
    assert.match(lines.at(-1) ?? "", /^Embedded frame:/);
  });
});
