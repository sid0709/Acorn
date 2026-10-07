import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TabUsageLedger, tallySummary, type UsageEntryRow } from "./tab-usage-ledger.ts";

function row(id: string, createdAt: string, costNanos: number, model = "jev"): UsageEntryRow {
  return {
    id,
    model,
    promptTokens: 10,
    completionTokens: 2,
    totalTokens: 12,
    price: "",
    costNanos,
    priced: true,
    durationMs: 5,
    error: "",
    createdAt,
  };
}

describe("TabUsageLedger", () => {
  it("adds a pushed call once, newest first, summing nanos exactly", () => {
    const ledger = new TabUsageLedger(10);
    assert.equal(ledger.append(row("a", "2026-10-07T05:00:00Z", 74_710)), true);
    assert.equal(ledger.append(row("b", "2026-10-07T05:00:02Z", 236_230)), true);
    assert.equal(ledger.append(row("a", "2026-10-07T05:00:00Z", 74_710)), false);
    const view = ledger.snapshot();
    assert.deepEqual(
      view.entries.map((entry) => entry.id),
      ["b", "a"],
    );
    assert.equal(view.totalNanos, 310_940);
  });

  it("takes the server's list and keeps calls pushed after it was read", () => {
    const ledger = new TabUsageLedger(10);
    ledger.append(row("old", "2026-10-07T05:00:00Z", 5));
    ledger.append(row("late", "2026-10-07T05:00:09Z", 7));
    ledger.replace(
      [row("old", "2026-10-07T05:00:00Z", 5), row("x", "2026-10-07T05:00:01Z", 3)],
      1_000,
    );
    const view = ledger.snapshot();
    assert.deepEqual(
      view.entries.map((entry) => entry.id),
      ["late", "x", "old"],
    );
    assert.equal(view.totalNanos, 1_007);
    assert.equal(ledger.append(row("x", "2026-10-07T05:00:01Z", 3)), false);
  });

  it("reports only the calls since a mark", () => {
    const ledger = new TabUsageLedger(10);
    ledger.append(row("before", "2026-10-07T05:00:00Z", 100, "gpt"));
    const mark = ledger.mark();
    ledger.append(row("during", "2026-10-07T05:00:01Z", 250, "jev"));
    const summary = tallySummary(ledger.since(mark));
    assert.equal(summary.calls, 1);
    assert.equal(summary.model, "jev");
    assert.equal(summary.costUsd, 250 / 1e9);
  });

  it("keeps two tabs apart", () => {
    const a = new TabUsageLedger(10);
    const b = new TabUsageLedger(10);
    a.append(row("only-a", "2026-10-07T05:00:00Z", 9));
    assert.equal(b.snapshot().entries.length, 0);
    assert.equal(b.snapshot().totalNanos, 0);
  });
});
