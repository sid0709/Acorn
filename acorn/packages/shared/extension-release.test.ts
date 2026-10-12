import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOlderVersion } from "./extension-release.ts";

describe("isOlderVersion", () => {
  it("compares each part as a number", () => {
    assert.equal(isOlderVersion("1.9.0", "1.10.0"), true);
    assert.equal(isOlderVersion("1.40.1", "1.41.0"), true);
    assert.equal(isOlderVersion("1.41.0", "1.41.0"), false);
    assert.equal(isOlderVersion("1.41.1", "1.41.0"), false);
    assert.equal(isOlderVersion("2.0.0", "1.99.99"), false);
  });

  it("reads a leading v and missing parts as zero", () => {
    assert.equal(isOlderVersion("v1.41", "1.41.1"), true);
    assert.equal(isOlderVersion("1.41.0", "v1.41"), false);
  });
});
