import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_STOP_REASON, AGENT_UNAVAILABLE_KIND } from "./agent-contract.ts";
import { RUN_FAILURE_REASON, RUN_STAGE } from "./run-types.ts";
import {
  ERROR_CODE,
  LOCAL_ERROR_CODE,
  READY_TO_SUBMIT,
  describeError,
  describeJobUnavailable,
  describeRunFailure,
} from "./user-messages.ts";

describe("describeError", () => {
  it("says what to do for each code the backend sends", () => {
    for (const code of Object.values(ERROR_CODE)) {
      const message = describeError({ code, message: "raw" });
      assert.ok(message.title.length > 0 && message.detail.length > 0, code);
      assert.notEqual(message.title, "Something went wrong", code);
    }
    assert.match(describeError({ code: ERROR_CODE.noCredits }).detail, /Add credits/);
    assert.equal(describeError({ code: ERROR_CODE.noKey }).action, "open-profile");
  });

  it("uses the status when the server gave no code", () => {
    assert.equal(describeError({ status: 402 }).title, "Your OpenRouter balance is too low");
    assert.equal(describeError({ status: 429 }).title, "OpenRouter is limiting requests");
    assert.equal(describeError({ status: 401 }).title, "You're signed out");
  });

  it("reads the extension's own error text", () => {
    assert.equal(describeError({ message: "Failed to fetch" }).title, "Can't reach Acorn");
    assert.equal(
      describeError({ message: "Sign in to Acorn required" }).title,
      "You're signed out",
    );
    assert.equal(
      describeError({
        message: 'Could not click "Submit" after 3 fresh reads: Control is disabled',
      }).title,
      "The page isn't letting Acorn press this yet",
    );
    assert.equal(
      describeError({ message: "AI analyze failed: 502" }).title,
      "The AI service isn't answering",
    );
    assert.equal(describeError({ message: "Profile failed: 500" }).title, "Something went wrong");
  });

  it("keeps the raw text for the Details and never shows it as the title", () => {
    const message = describeError({ message: "weird internal thing" });
    assert.equal(message.technical, "weird internal thing");
    assert.ok(!message.title.includes("weird"));
  });

  it("has a message for every local code", () => {
    for (const code of Object.values(LOCAL_ERROR_CODE)) {
      assert.ok(describeError({ code }).title.length > 0, code);
    }
  });
});

describe("describeRunFailure", () => {
  const failure = (reason: string, label: string, detail = "", code?: string) => ({
    reason,
    label,
    detail,
    code,
    stage: RUN_STAGE.advancing,
  });

  it("gives every reason the run names a next step", () => {
    for (const reason of Object.values(RUN_FAILURE_REASON)) {
      if (
        reason === RUN_FAILURE_REASON.stoppedByUser ||
        reason === RUN_FAILURE_REASON.aiUnavailable
      ) {
        continue;
      }
      const message = describeRunFailure(failure(reason, "The label"));
      assert.ok(message.detail.length > 0, reason);
    }
  });

  it("explains an AI failure by its code, not the raw model text", () => {
    const message = describeRunFailure(
      failure(
        RUN_FAILURE_REASON.aiUnavailable,
        "model request failed (402)",
        "Page read failed",
        ERROR_CODE.noCredits,
      ),
    );
    assert.equal(message.title, "Your OpenRouter balance is too low");
    assert.match(message.technical, /402/);
  });

  it("keeps the model's own words for a reason it made up", () => {
    const message = describeRunFailure(failure("other", "The site wants a phone call", "Call us"));
    assert.equal(message.title, "The site wants a phone call");
    assert.equal(message.detail, "Call us");
  });

  it("names how a job is unavailable by the agent's kind, with what the page said", () => {
    const stop = (kind: string | undefined) => ({
      ...failure(RUN_FAILURE_REASON.jobUnavailable, "closed"),
      agentStop: {
        reason: AGENT_STOP_REASON.jobUnavailable,
        ...(kind ? { kind } : {}),
        problem: "The posting says this position has been filled.",
        action: "",
      },
    });
    const expired = describeRunFailure(stop(AGENT_UNAVAILABLE_KIND.expired));
    assert.equal(expired.title, "This job is no longer open");
    assert.match(expired.detail, /^The posting says this position has been filled\./);
    assert.match(expired.detail, /move on to another job/);
    assert.equal(expired.severity, "info");
    assert.equal(
      describeRunFailure(stop(AGENT_UNAVAILABLE_KIND.noOnlineApply)).title,
      "This job only takes applications by email, phone or in person",
    );
    assert.equal(
      describeRunFailure(stop(AGENT_UNAVAILABLE_KIND.notAJob)).title,
      "This link isn't a job application",
    );
    assert.equal(describeRunFailure(stop(undefined)).title, "This job can't be applied to online");
    assert.equal(describeJobUnavailable("haunted", " x ").detail, "x");
  });
});

describe("READY_TO_SUBMIT", () => {
  it("says the application was not sent and who sends it", () => {
    assert.equal(READY_TO_SUBMIT.title, "Ready to submit");
    assert.match(READY_TO_SUBMIT.detail, /press Submit yourself/);
    assert.match(READY_TO_SUBMIT.detail, /did not send/);
  });
});
