import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_ERROR_CODE, AGENT_STOP_REASON, AGENT_UNAVAILABLE_KIND } from "./agent-contract.ts";
import { RUN_FAILURE_REASON, RUN_OUTCOME, RUN_STAGE, type RunFailure } from "./run-types.ts";
import {
  CATALOGUE_KEYS,
  ERROR_CODE,
  LOCAL_ERROR_CODE,
  NOTICE_ACTION,
  NOTICE_ACTION_LABEL,
  codeForAgentError,
  describeError,
  describeRunEnd,
  describeRunFailure,
  knowsErrorCode,
  type UserMessage,
} from "./user-messages.ts";

const SNAG = "Acorn hit a snag";

/** A message the person can act on: words, a tone, an icon, and at most two buttons that exist. */
function assertWhole(message: UserMessage, what: string): void {
  assert.ok(message.title.trim().length > 0, `${what}: title`);
  assert.ok(message.detail.trim().length > 0, `${what}: detail`);
  assert.ok(message.tone, `${what}: tone`);
  assert.ok(message.glyph, `${what}: glyph`);
  assert.ok(message.actions.length <= 2, `${what}: at most two buttons`);
  for (const action of message.actions)
    assert.ok(NOTICE_ACTION_LABEL[action], `${what}: ${action}`);
}

const failure = (reason: string, label: string, rest: Partial<RunFailure> = {}): RunFailure => ({
  reason,
  label,
  detail: "",
  stage: RUN_STAGE.filling,
  ...rest,
});

const stopped = (
  reason: string,
  status: string = RUN_FAILURE_REASON.waitedForPerson,
  kind?: string,
): RunFailure =>
  failure(status, "raw label", {
    agentStop: { reason, ...(kind ? { kind } : {}), problem: "", action: "" },
  });

describe("the catalogue covers every case", () => {
  it("has words for every code acorn-backend and the extension raise", () => {
    for (const code of [...Object.values(ERROR_CODE), ...Object.values(LOCAL_ERROR_CODE)]) {
      assert.ok(knowsErrorCode(code), code);
      assertWhole(describeError({ code, message: "raw" }), code);
    }
  });

  it("maps every code the agent server sends to one it has words for", () => {
    for (const code of Object.values(AGENT_ERROR_CODE)) {
      const mapped = codeForAgentError(code);
      assert.ok(mapped && knowsErrorCode(mapped), code);
      assertWhole(describeError({ code, message: "raw" }), code);
    }
  });

  it("has its own words for every stop the agent makes", () => {
    for (const reason of Object.values(AGENT_STOP_REASON)) {
      if (reason === AGENT_STOP_REASON.jobUnavailable) continue;
      assert.ok(knowsErrorCode(CATALOGUE_KEYS.stop(reason)), reason);
      const said = describeRunFailure(stopped(reason));
      assertWhole(said, reason);
      assert.notEqual(said.title, SNAG, reason);
    }
  });

  it("has words for every way a job can be unavailable", () => {
    for (const kind of Object.values(AGENT_UNAVAILABLE_KIND)) {
      assert.ok(knowsErrorCode(CATALOGUE_KEYS.unavailable(kind)), kind);
      const said = describeRunFailure(
        stopped(AGENT_STOP_REASON.jobUnavailable, RUN_FAILURE_REASON.jobUnavailable, kind),
      );
      assertWhole(said, kind);
    }
  });

  it("has words for every failure the run names", () => {
    for (const reason of Object.values(RUN_FAILURE_REASON)) {
      if (reason === RUN_FAILURE_REASON.aiUnavailable) continue;
      assert.ok(knowsErrorCode(CATALOGUE_KEYS.failure(reason)), reason);
      assertWhole(describeRunFailure(failure(reason, "raw label")), reason);
    }
  });

  it("has words for every way a run ends", () => {
    for (const outcome of Object.values(RUN_OUTCOME)) {
      assertWhole(describeRunEnd({ outcome, pages: 1, refills: 0 }), outcome);
    }
  });
});

describe("raw text is never what the person reads", () => {
  it("keeps raw text in technical only", () => {
    const said = describeError({ message: "weird internal thing" });
    assert.equal(said.title, SNAG);
    assert.equal(said.technical, "weird internal thing");
    assert.ok(!said.detail.includes("weird"));
  });

  it("does not show a failure's raw label as its title", () => {
    for (const reason of Object.values(RUN_FAILURE_REASON)) {
      const said = describeRunFailure(failure(reason, "TypeError: x is undefined"));
      assert.ok(!said.title.includes("TypeError"), reason);
      assert.ok(!said.detail.includes("TypeError"), reason);
    }
  });

  it("reads browser errors as what they mean", () => {
    assert.equal(
      describeError({ message: "Frame with ID 1572 was removed." }).title,
      "The page changed",
    );
    assert.equal(describeError({ message: "No tab with id: 12." }).title, "The tab was closed");
    assert.equal(
      describeError({ message: "Cannot access a chrome:// URL" }).title,
      "Acorn can't work on this page",
    );
    assert.equal(
      describeError({ message: "Debugger is not attached to the tab with id: 4." }).title,
      "Acorn lost control of the tab",
    );
  });
});

describe("the words", () => {
  it("tells a low balance by its code, its status, or the agent's code, with a way to add credits", () => {
    for (const said of [
      describeError({ code: ERROR_CODE.noCredits }),
      describeError({ status: 402 }),
      describeError({ code: AGENT_ERROR_CODE.noCredits, message: "model request failed (402)" }),
    ]) {
      assert.equal(said.title, "Your OpenRouter balance is empty");
      assert.deepEqual(said.actions, [NOTICE_ACTION.addCredits, NOTICE_ACTION.continue]);
      assert.equal(said.sticky, true);
    }
  });

  it("tells a run the server no longer holds to run again", () => {
    const said = describeError({ code: AGENT_ERROR_CODE.runOver });
    assert.equal(said.title, "This run ended");
    assert.deepEqual(said.actions, [NOTICE_ACTION.runAgain]);
  });

  it("tells a duplicate application apart from one just sent, both as success", () => {
    const sent = describeRunEnd({ outcome: RUN_OUTCOME.completed, pages: 1, refills: 0 });
    const again = describeRunEnd({
      outcome: RUN_OUTCOME.completed,
      pages: 1,
      refills: 0,
      alreadyApplied: true,
    });
    assert.equal(sent.title, "Application sent");
    assert.equal(again.title, "Already applied");
    assert.equal(sent.tone, "success");
    assert.equal(again.tone, "success");
  });

  it("keeps a stop's own words from the page as its description and first step", () => {
    const said = describeRunFailure(
      failure(RUN_FAILURE_REASON.waitedForPerson, "raw", {
        agentStop: {
          reason: AGENT_STOP_REASON.verification,
          problem: "The form asks for an 8-character code sent to your email.",
          action: "Type the code into the boxes.",
        },
      }),
    );
    assert.equal(said.title, "Enter the code from your email");
    assert.equal(said.detail, "The form asks for an 8-character code sent to your email.");
    assert.equal(said.steps[0], "Type the code into the boxes.");
    assert.deepEqual(said.actions, [NOTICE_ACTION.continue]);
  });

  it("tells a stuck 'other' stop apart from one that needs the person", () => {
    assert.equal(
      describeRunFailure(stopped(AGENT_STOP_REASON.other)).title,
      "Acorn needs you here",
    );
    assert.equal(
      describeRunFailure(stopped(AGENT_STOP_REASON.other, RUN_FAILURE_REASON.noProgress)).title,
      "Acorn couldn't finish this page",
    );
  });

  it("says a page that never confirmed the send could not be confirmed, not that it failed", () => {
    const said = describeRunFailure(
      stopped(AGENT_STOP_REASON.notConfirmed, RUN_FAILURE_REASON.noProgress),
    );
    assert.equal(said.title, "Couldn't confirm it was sent");
  });

  it("is ready for the person to submit, and stays until they do", () => {
    const said = describeRunEnd({ outcome: RUN_OUTCOME.readyToSubmit, pages: 1, refills: 0 });
    assert.match(said.detail, /press Submit yourself/);
    assert.equal(said.sticky, true);
  });
});
