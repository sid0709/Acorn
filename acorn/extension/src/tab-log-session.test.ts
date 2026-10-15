import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { entriesToPrune, type TabLogEntry } from "./tab-log-session.ts";

const entry = (id: string, t: number, runId: string | undefined, chars = 10): TabLogEntry => ({
  id,
  t,
  runId,
  kind: "event",
  title: "",
  text: "x".repeat(chars),
});

describe("entriesToPrune", () => {
  it("keeps every run while the tab is inside its limits", () => {
    const entries = [entry("a", 1, "r1"), entry("b", 2, "r2")];
    assert.equal(entriesToPrune(entries, 5, 1000).size, 0);
  });

  it("drops the oldest runs whole when there are more than the limit", () => {
    const entries = [
      entry("a1", 1, "r1"),
      entry("a2", 2, "r1"),
      entry("b", 3, "r2"),
      entry("c", 4, "r3"),
    ];
    assert.deepEqual([...entriesToPrune(entries, 2, 1000)].sort(), ["a1", "a2"]);
  });

  it("drops oldest runs until the rest fits the size, never the newest run", () => {
    const entries = [entry("a", 1, "r1", 600), entry("b", 2, "r2", 600), entry("c", 3, "r3", 600)];
    assert.deepEqual([...entriesToPrune(entries, 5, 1000)].sort(), ["a", "b"]);
    assert.equal(entriesToPrune([entry("only", 1, "r1", 5000)], 5, 1000).size, 0);
  });

  it("treats entries before any run as the oldest run", () => {
    const entries = [entry("early", 1, undefined), entry("a", 2, "r1"), entry("b", 3, "r2")];
    assert.deepEqual([...entriesToPrune(entries, 2, 1000)], ["early"]);
  });
});
