import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { labelMatches } from "./label-match.ts";

describe("labelMatches", () => {
  it("matches the field's own question", () => {
    assert.equal(labelMatches("Full name", ["Full name *"]), true);
  });

  it("never matches through a required mark alone", () => {
    assert.equal(labelMatches("Full name", ["*", "0/300"]), false);
  });

  it("never matches through punctuation-only text", () => {
    assert.equal(labelMatches("What is your experience with AWS?", ["?", "—"]), false);
  });
});
