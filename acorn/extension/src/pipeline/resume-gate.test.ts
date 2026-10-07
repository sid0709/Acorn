import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RESUME_NOT_CHOSEN, resumeGate } from "./resume-gate.ts";

describe("resumeGate", () => {
  it("lets a run act once the tab has a résumé", () => {
    assert.deepEqual(resumeGate(true), { ok: true });
  });

  it("stops with the recommend's own reason", () => {
    assert.deepEqual(resumeGate(false, "No job description to recommend from"), {
      ok: false,
      reason: "No job description to recommend from",
    });
  });

  it("stops when the recommend chose nothing and said nothing", () => {
    assert.deepEqual(resumeGate(false), { ok: false, reason: RESUME_NOT_CHOSEN });
  });
});
