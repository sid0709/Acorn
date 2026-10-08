import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PhaseClock } from "./phase-clock.ts";

describe("PhaseClock", () => {
  it("adds repeated phases together", () => {
    const clock = new PhaseClock();
    clock.add("click", 300);
    clock.add("fill", 1_000);
    clock.add("click", 200);
    assert.deepEqual(clock.summary(), { click: 500, fill: 1_000 });
  });

  it("counts a phase that throws", async () => {
    const clock = new PhaseClock();
    await assert.rejects(clock.time("read", () => Promise.reject(new Error("no answer"))));
    assert.ok("read" in clock.summary());
  });
});
