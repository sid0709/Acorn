import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONTROL_ROLE } from "@acorn/shared/run-types";

import { isNewStep } from "./run-step.ts";

const form = { url: "https://jobs.example/apply?id=1", signature: "a" };

describe("isNewStep", () => {
  it("keeps the step when the run's own fill changed the page's fields", () => {
    assert.equal(
      isNewStep({ previous: form, page: { ...form, signature: "b" }, settled: null }),
      false,
    );
  });

  it("keeps the step when a click left the page where it was", () => {
    assert.equal(
      isNewStep({ previous: form, page: { ...form, signature: "b" }, settled: "unchanged" }),
      false,
    );
  });

  it("moves on when a click changed the step", () => {
    assert.equal(
      isNewStep({ previous: form, page: { ...form, signature: "b" }, settled: "changed" }),
      true,
    );
  });

  it("keeps the step when the site drew the same form again with refused fields", () => {
    assert.equal(
      isNewStep({ previous: form, page: { ...form, flagged: 1 }, settled: "navigated" }),
      false,
    );
  });

  it("moves on when a navigation drew the same form with nothing refused", () => {
    assert.equal(isNewStep({ previous: form, page: form, settled: "navigated" }), true);
  });

  it("keeps the step when a reload drew the same fields again, whatever the page now says", () => {
    const fields = { ...form, fieldsKey: "k1" };
    assert.equal(
      isNewStep({ previous: fields, page: { ...fields, signature: "b" }, settled: "navigated" }),
      false,
    );
  });

  it("moves on when a reload drew other fields at the same address", () => {
    assert.equal(
      isNewStep({
        previous: { ...form, fieldsKey: "k1" },
        page: { ...form, signature: "b", fieldsKey: "k2" },
        settled: "navigated",
      }),
      true,
    );
  });

  it("moves on to a new address", () => {
    assert.equal(
      isNewStep({
        previous: form,
        page: { url: "https://jobs.example/thanks", signature: "a" },
        settled: null,
      }),
      true,
    );
  });

  it("starts with a new step", () => {
    assert.equal(isNewStep({ previous: null, page: form, settled: null }), true);
  });

  it("keeps the step when a requirement's click opened an entry form in place", () => {
    assert.equal(
      isNewStep({
        previous: form,
        page: { ...form, signature: "b" },
        settled: "changed",
        role: CONTROL_ROLE.resolve,
      }),
      false,
    );
  });

  it("keeps the step when saving what that click opened closed it", () => {
    assert.equal(
      isNewStep({
        previous: form,
        page: { ...form, signature: "c" },
        settled: "changed",
        role: CONTROL_ROLE.commit,
      }),
      false,
    );
  });

  it("moves on when a requirement's click opened another address", () => {
    assert.equal(
      isNewStep({
        previous: form,
        page: { url: "https://assess.example/test", signature: "a" },
        settled: "navigated",
        role: CONTROL_ROLE.resolve,
      }),
      true,
    );
  });

  it("moves on when a requirement's click opened a new tab", () => {
    assert.equal(
      isNewStep({ previous: form, page: form, settled: "new-tab", role: CONTROL_ROLE.resolve }),
      true,
    );
  });

  it("moves on when the forward control changed the step in place", () => {
    assert.equal(
      isNewStep({
        previous: form,
        page: { ...form, signature: "b" },
        settled: "changed",
        role: CONTROL_ROLE.next,
      }),
      true,
    );
  });
});
