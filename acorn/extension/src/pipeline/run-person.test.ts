import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldWaitForPerson, stillAsksForPerson } from "./run-person.ts";

describe("shouldWaitForPerson", () => {
  it("does not wait when the model asked for nothing", () => {
    assert.equal(
      shouldWaitForPerson({ needsPerson: false, isForm: true, fields: 0, clicks: 0 }),
      false,
    );
  });

  it("fills a form with fields first, whatever the model said", () => {
    assert.equal(
      shouldWaitForPerson({ needsPerson: true, isForm: true, fields: 19, clicks: 0 }),
      false,
    );
  });

  it("waits once the form was sent and the page still asks", () => {
    assert.equal(
      shouldWaitForPerson({ needsPerson: true, isForm: true, fields: 19, clicks: 1 }),
      true,
    );
  });

  it("waits on a page with nothing to fill", () => {
    assert.equal(
      shouldWaitForPerson({ needsPerson: true, isForm: true, fields: 0, clicks: 0 }),
      true,
    );
    assert.equal(
      shouldWaitForPerson({ needsPerson: true, isForm: false, fields: 5, clicks: 0 }),
      true,
    );
  });
});

describe("stillAsksForPerson", () => {
  it("is true while the page asks the applicant or for an emailed code", () => {
    assert.equal(stillAsksForPerson({ needsPerson: true, mailVerification: false }), true);
    assert.equal(stillAsksForPerson({ needsPerson: false, mailVerification: true }), true);
    assert.equal(stillAsksForPerson({ needsPerson: false, mailVerification: false }), false);
  });
});
