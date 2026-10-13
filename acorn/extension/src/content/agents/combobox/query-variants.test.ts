import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { laterWordQueries } from "./query-variants.ts";

describe("laterWordQueries", () => {
  it("searches from later words, longest first", () => {
    assert.deepEqual(laterWordQueries("The University of Texas at Austin"), [
      "University of Texas at Austin",
      "of Texas at Austin",
    ]);
  });

  it("has nothing to add for a single word", () => {
    assert.deepEqual(laterWordQueries("93705"), []);
  });

  it("skips a variant too short to narrow a list", () => {
    assert.deepEqual(laterWordQueries("525 W Vassar Ave"), ["W Vassar Ave", "Vassar Ave"]);
    assert.deepEqual(laterWordQueries("Go to"), []);
  });
});
