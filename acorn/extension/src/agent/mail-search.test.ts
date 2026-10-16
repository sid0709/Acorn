import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAIL_SEARCH_STATE, VERIFICATION } from "@acorn/shared/run-types";

import {
  afterLook,
  foundIn,
  likeliestEmailId,
  lookLogFields,
  mailEmails,
  missed,
  senderName,
  startMailSearch,
} from "./mail-search";
import { isEmailVerificationStop, verificationKindFor } from "./mail-verification";

const raw = [
  {
    id: "a",
    from: "Reddit <no-reply@reddit.example>",
    subject: "Security code for your application",
    receivedAt: "2026-10-16T20:54:36Z",
    after: true,
    judged: true,
    probability: 0.93,
  },
  {
    id: "b",
    from: "A newsletter",
    subject: "Weekly digest",
    receivedAt: "2026-10-16T20:50:00Z",
    after: false,
    judged: false,
    probability: 0,
  },
];

describe("what the run shows of its look in Gmail", () => {
  it("turns the backend's emails into the sidebar's, with times in ms", () => {
    const emails = mailEmails(raw);
    assert.equal(emails[0]?.receivedAt, Date.parse("2026-10-16T20:54:36Z"));
    assert.equal(emails[0]?.judged, true);
    assert.equal(emails[1]?.after, false);
    assert.equal(mailEmails(undefined).length, 0);
  });

  it("counts each look, replaces the emails, and keeps the last list when a look read none", () => {
    let search = startMailSearch(VERIFICATION.emailCode, 1000);
    search = afterLook(search, raw);
    assert.equal(search.looks, 1);
    assert.equal(search.emails.length, 2);
    search = afterLook(search, undefined);
    assert.equal(search.looks, 2);
    assert.equal(search.emails.length, 2);
  });

  it("marks the email the value came from, and a search that ended without one", () => {
    const search = afterLook(startMailSearch(VERIFICATION.emailCode, 1000), raw);
    assert.deepEqual(
      [foundIn(search, "a").state, foundIn(search, "a").chosenId],
      [MAIL_SEARCH_STATE.found, "a"],
    );
    assert.equal(missed(search, "timeout").state, MAIL_SEARCH_STATE.missed);
    assert.equal(missed(search, "timeout").detail, "timeout");
  });

  it("names the likeliest email among those the model weighed, and the sender without the address", () => {
    const search = afterLook(startMailSearch(VERIFICATION.emailCode, 1000), raw);
    assert.equal(likeliestEmailId(search.emails), "a");
    assert.equal(likeliestEmailId(mailEmails([raw[1] ?? {}])), undefined);
    assert.equal(senderName("Reddit <no-reply@reddit.example>"), "Reddit");
    assert.equal(senderName("<only@address.example>"), "<only@address.example>");
  });

  it("logs what was read and judged, never an email's address or id", () => {
    const search = afterLook(startMailSearch(VERIFICATION.emailCode, 1000), raw);
    const fields = lookLogFields(search, "decision-model");
    assert.equal(fields.emails.length, 2);
    assert.equal(fields.emails[0]?.probability, 0.93);
    assert.equal("id" in (fields.emails[0] ?? {}), false);
    assert.equal(fields.model, "decision-model");
  });
});

describe("what the agent stopped for", () => {
  it("is a link only when the model said so, never guessed from the page's wording", () => {
    const stop = (reason: string) => ({ reason, problem: "p", action: "a" });
    assert.equal(verificationKindFor(stop("verification")), VERIFICATION.emailCode);
    assert.equal(verificationKindFor(stop("verification_link")), VERIFICATION.emailLink);
    assert.equal(
      verificationKindFor({ reason: "verification", problem: "open the link", action: "link" }),
      VERIFICATION.emailCode,
    );
    assert.equal(isEmailVerificationStop("verification_link"), true);
    assert.equal(isEmailVerificationStop("captcha"), false);
  });
});
