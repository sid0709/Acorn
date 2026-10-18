import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CURSOR_TIP_PX, OVERLAY_SCRIPT } from "./overlay.ts";

describe("the overlay's cursor", () => {
  it("stands for its pointed end, not the centre of its box", () => {
    // The tip is the top of the "A" (viewBox 50, 14, less half its dark ring), inside a 44 px box.
    assert.deepEqual(CURSOR_TIP_PX, { x: 22, y: 2.86 });
  });

  it("is placed and turned about the tip, so a click lands where the tip is drawn", () => {
    assert.match(OVERLAY_SCRIPT, /margin-left: -22px/);
    assert.match(OVERLAY_SCRIPT, /margin-top: -2\.86px/);
    assert.match(OVERLAY_SCRIPT, /transform-origin: 22px 2\.86px/);
    assert.doesNotMatch(OVERLAY_SCRIPT, /transform-origin: center center/);
  });

  it("draws its outline from the same apex the tip is measured at", () => {
    assert.match(OVERLAY_SCRIPT, /"M 50 14 C /);
    assert.match(OVERLAY_SCRIPT, /50 14 Z"/);
  });
});

describe("the overlay in a tab that is not shown", () => {
  it("does not wait for a cursor that cannot glide, since a hidden tab draws no frames", () => {
    assert.match(OVERLAY_SCRIPT, /document\.visibilityState === "hidden"/);
  });
});

describe("an overlay left on a page by another build", () => {
  it("is taken off and replaced, so an updated extension never keeps drawing the old cursor", () => {
    assert.match(OVERLAY_SCRIPT, /existing\.version === VERSION/);
    assert.match(OVERLAY_SCRIPT, /existing\.remove\(\)/);
    assert.match(OVERLAY_SCRIPT, /version: VERSION/);
  });
});
