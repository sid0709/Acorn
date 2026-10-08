import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextRetryDelay } from "./socket-backoff.ts";

const opts = { baseMs: 1_000, maxMs: 30_000, jitter: 0.5 };
const mid = () => 0.5;

describe("nextRetryDelay", () => {
  it("doubles each attempt without jitter", () => {
    assert.deepEqual(
      [0, 1, 2, 3].map((a) => nextRetryDelay(a, opts, mid)),
      [1_000, 2_000, 4_000, 8_000],
    );
  });

  it("caps at maxMs", () => {
    assert.equal(nextRetryDelay(20, opts, mid), 30_000);
    assert.equal(
      nextRetryDelay(20, opts, () => 0.999),
      30_000,
    );
  });

  it("spreads around the step but never below baseMs", () => {
    assert.equal(
      nextRetryDelay(2, opts, () => 0),
      2_000,
    );
    assert.equal(
      nextRetryDelay(2, opts, () => 1),
      6_000,
    );
    assert.equal(
      nextRetryDelay(0, opts, () => 0),
      1_000,
    );
  });
});
