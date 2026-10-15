import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeLog } from "./log-summary.ts";

import type { TabLogEntry } from "./tab-log-session.ts";

const at = (t: number, patch: Partial<TabLogEntry>): TabLogEntry => ({
  id: String(t),
  t,
  kind: "event",
  title: "background · run:read",
  text: "{}",
  runId: "r1",
  ...patch,
});

describe("summarizeLog", () => {
  it("reads how a run ended and what went wrong along the way", () => {
    const entries = [
      at(1, { title: "background · run:run:start" }),
      at(2, { level: "warn", title: "background · run:click:missed" }),
      at(9, {
        title: "background · run:run:end",
        text: JSON.stringify({
          outcome: "failed",
          reason: "no_progress",
          seconds: 8,
          phases: { fill: 4 },
        }),
      }),
    ];
    const summary = summarizeLog(entries, "1.0.0", 100);
    assert.equal(summary.runs.length, 1);
    assert.equal(summary.runs[0].outcome, "failed");
    assert.equal(summary.runs[0].reason, "no_progress");
    assert.equal(summary.runs[0].warnings, 1);
    assert.equal(summary.runs[0].lastProblem, "background · run:click:missed");
    assert.deepEqual(summary.runs[0].phases, { fill: 4 });
    assert.equal(summary.warnings, 1);
  });

  it("calls a run with no closing event unfinished", () => {
    const summary = summarizeLog([at(1, {}), at(5, { runId: "r2" })], "1.0.0", 100);
    assert.deepEqual(
      summary.runs.map((run) => [run.runId, run.outcome]),
      [
        ["r1", "unfinished"],
        ["r2", "unfinished"],
      ],
    );
  });
});
