import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatNanosUsd } from "./ai-usage.ts";

describe("formatNanosUsd", () => {
  it("keeps sub-cent amounts readable", () => {
    assert.equal(formatNanosUsd(4_200_000), "$0.0042");
    assert.equal(formatNanosUsd(120_000), "$0.00012");
  });

  it("shows cents and dollars with fewer decimals", () => {
    assert.equal(formatNanosUsd(35_000_000), "$0.035");
    assert.equal(formatNanosUsd(2_500_000_000), "$2.50");
  });

  it("is zero-safe and marks a missing figure", () => {
    assert.equal(formatNanosUsd(0), "$0.00000");
    assert.equal(formatNanosUsd(null), "$?");
  });
});
