import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { successorTab } from "./run-tabs.ts";

describe("successorTab", () => {
  it("goes on in the tab the closed one opened, the newest first", () => {
    const open = [
      { id: 7, openerTabId: 3, lastAccessed: 100 },
      { id: 9, openerTabId: 3, lastAccessed: 200 },
      { id: 4 },
    ];
    assert.equal(successorTab(3, open, [4, 3]), 9);
  });

  it("goes back to the run's own latest tab still open", () => {
    assert.equal(successorTab(3, [{ id: 1 }, { id: 4 }], [1, 4, 3]), 4);
  });

  it("finds none when nothing is left", () => {
    assert.equal(successorTab(3, [{ id: 8 }], [3]), null);
  });
});
