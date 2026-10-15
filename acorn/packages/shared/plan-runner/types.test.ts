import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ELEMENT_NOT_FOUND, planTargetsGone } from "./types.ts";

describe("planTargetsGone", () => {
  it("is true when every step lost its element", () => {
    const steps = [{ message: `${ELEMENT_NOT_FOUND} 52` }, { message: `${ELEMENT_NOT_FOUND} 59` }];
    assert.equal(planTargetsGone(steps), true);
  });

  it("is false when any step did something else, or there are none", () => {
    assert.equal(
      planTargetsGone([{ message: `${ELEMENT_NOT_FOUND} 52` }, { message: "ok" }]),
      false,
    );
    assert.equal(planTargetsGone([]), false);
  });
});
