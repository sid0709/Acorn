import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_STATUS, AGENT_STOP_REASON } from "@acorn/shared/agent-contract";
import { RUN_FAILURE_REASON } from "@acorn/shared/run-types";

import { failureFromStatus } from "./progress.ts";

describe("failureFromStatus", () => {
  it("carries why the agent stopped, in its own plain words, for the Now card", () => {
    const failure = failureFromStatus(AGENT_STATUS.needPerson, "Solve the CAPTCHA", {
      reason: AGENT_STOP_REASON.captcha,
      problem: "The page asks you to prove you're not a robot.",
      action: "Tick the box and solve the picture puzzle.",
    });
    assert.equal(failure.reason, RUN_FAILURE_REASON.waitedForPerson);
    assert.equal(failure.label, "The page asks you to prove you're not a robot.");
    assert.equal(failure.detail, "Tick the box and solve the picture puzzle.");
    assert.deepEqual(failure.agentStop, {
      reason: "captcha",
      problem: "The page asks you to prove you're not a robot.",
      action: "Tick the box and solve the picture puzzle.",
    });
  });

  it("falls back to the agent's message when an older server sends no stop", () => {
    const failure = failureFromStatus(AGENT_STATUS.stuck, "The Next button does nothing");
    assert.equal(failure.reason, RUN_FAILURE_REASON.noProgress);
    assert.equal(failure.label, "The Next button does nothing");
    assert.equal(failure.agentStop, undefined);
  });
});
