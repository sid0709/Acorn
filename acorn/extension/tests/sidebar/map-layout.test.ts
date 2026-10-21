import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FOLD_BAND_PX,
  FOLD_MIN_PAGE_PX,
  FOLD_PAD_PAGE_PX,
  layoutMap,
  mapY,
  pageY,
} from "../../src/sidebar/map-layout.ts";

/** A form of four fields at the foot of a page 6,600 pixels tall, under a long job description. */
const FORM = [4200, 4300, 4400, 6300].map((y) => ({ y, h: 40 }));

describe("the map's column", () => {
  it("draws a page with nothing on it yet whole, top to bottom", () => {
    const layout = layoutMap(6600, [], 300);
    assert.equal(layout.segments.length, 1);
    assert.equal(layout.height, 300);
    assert.equal(mapY(layout, 3300), 150);
  });

  it("folds the stretches with nothing on them, so the form is drawn across the map", () => {
    const layout = layoutMap(6600, FORM, 300);
    const folds = layout.segments.filter((segment) => segment.folded);
    assert.deepEqual(
      folds.map((fold) => [fold.from, fold.to]),
      [
        [0, 4200 - FOLD_PAD_PAGE_PX],
        [4440 + FOLD_PAD_PAGE_PX, 6300 - FOLD_PAD_PAGE_PX],
      ],
    );
    assert.ok(folds.every((fold) => fold.height === FOLD_BAND_PX));
    assert.ok(Math.abs(layout.height - 300) < 1e-6, "the map is filled");
    const form = mapY(layout, 4440) - mapY(layout, 4200);
    const linear = ((4440 - 4200) * 300) / 6600;
    assert.ok(form > linear * 5, `the form's first fields take ${form} px, not ${linear}`);
  });

  it("keeps a short gap between fields as it is", () => {
    const near = [
      { y: 1000, h: 40 },
      { y: 1000 + FOLD_MIN_PAGE_PX - 1, h: 40 },
    ];
    const layout = layoutMap(1800, near, 300);
    assert.ok(layout.segments.filter((segment) => segment.folded).length <= 1);
    assert.ok(
      layout.segments.every(
        (segment) => !(segment.folded && segment.from > 1000 && segment.to < 1700),
      ),
    );
  });

  it("keeps the page's order both ways, through the folds", () => {
    const layout = layoutMap(6600, FORM, 300);
    let last = -1;
    for (let y = 0; y <= 6600; y += 50) {
      const drawn = mapY(layout, y);
      assert.ok(drawn >= last, `${y} is drawn below what is above it`);
      last = drawn;
      if (
        !layout.segments.find((segment) => segment.folded && y > segment.from && y < segment.to)
      ) {
        assert.ok(Math.abs(pageY(layout, drawn) - y) < 1e-6, `${y} comes back as itself`);
      }
    }
  });

  it("folds only the longest stretches when there are too many to fit", () => {
    const scattered = Array.from({ length: 20 }, (_, i) => ({ y: i * 2000, h: 40 }));
    const layout = layoutMap(40_000, scattered, 160);
    const folds = layout.segments.filter((segment) => segment.folded);
    assert.ok(folds.length * FOLD_BAND_PX <= 160 * 0.3);
    assert.ok(layout.height <= 160);
  });

  it("does not draw a short form larger than its page", () => {
    const layout = layoutMap(300, [{ y: 100, h: 40 }], 400);
    assert.equal(layout.height, 300);
  });
});
