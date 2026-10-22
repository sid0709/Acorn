import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRelativeTime } from "./relative-time.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

describe("formatRelativeTime", () => {
  it("counts minutes, hours and days", () => {
    assert.equal(formatRelativeTime(NOW - 10_000, NOW), "now");
    assert.equal(formatRelativeTime(NOW - 5 * 60_000, NOW), "5m");
    assert.equal(formatRelativeTime(NOW - 3 * 3_600_000, NOW), "3h");
    assert.equal(formatRelativeTime(NOW - 2 * 86_400_000, NOW), "2d");
  });

  it("never reads a future time as negative", () => {
    assert.equal(formatRelativeTime(NOW + 60_000, NOW), "now");
  });
});
