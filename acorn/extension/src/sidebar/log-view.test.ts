import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterEntries, groupByRun, sinceLabel } from "./log-view.ts";

import type { TabLogEntry } from "../tab-log-session.ts";

const entry = (id: string, t: number, patch: Partial<TabLogEntry> = {}): TabLogEntry => ({
  id,
  t,
  kind: "event",
  title: `title ${id}`,
  text: `text ${id}`,
  ...patch,
});

describe("filterEntries", () => {
  const entries = [
    entry("a", 1, { level: "warn" }),
    entry("b", 2, { kind: "pure-tree" }),
    entry("c", 3, { kind: "api", text: "Verification: other" }),
  ];

  it("shows only problems in the problems view", () => {
    assert.deepEqual(
      filterEntries(entries, "problems", "").map((e) => e.id),
      ["a"],
    );
  });

  it("shows the API calls in the AI view and trees in the trees view", () => {
    assert.deepEqual(
      filterEntries(entries, "ai", "").map((e) => e.id),
      ["c"],
    );
    assert.deepEqual(
      filterEntries(entries, "trees", "").map((e) => e.id),
      ["b"],
    );
  });

  it("searches title and text, ignoring case", () => {
    assert.deepEqual(
      filterEntries(entries, "all", "verification").map((e) => e.id),
      ["c"],
    );
    assert.deepEqual(
      filterEntries(entries, "all", "TITLE B").map((e) => e.id),
      ["b"],
    );
  });
});

describe("groupByRun", () => {
  it("makes one group per run in the order the runs began", () => {
    const all = [
      entry("x", 5, { runId: "r2" }),
      entry("y", 1, { runId: "r1" }),
      entry("z", 2, { runId: "r1" }),
      entry("w", 0),
    ];
    const groups = groupByRun(all, all, "1.0.0");
    assert.deepEqual(
      groups.map((g) => [g.runId, g.entries.map((e) => e.id)]),
      [
        [undefined, ["w"]],
        ["r1", ["y", "z"]],
        ["r2", ["x"]],
      ],
    );
  });
});

describe("sinceLabel", () => {
  it("counts from the start in seconds, then minutes", () => {
    assert.equal(sinceLabel(12_300, 0), "+12.3 s");
    assert.equal(sinceLabel(125_000, 0), "+2 m 5 s");
  });
});
