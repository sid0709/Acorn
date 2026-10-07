import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
});
