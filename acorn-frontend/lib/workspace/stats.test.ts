import { describe, expect, test } from "bun:test";
import { appliedContext, replyRateContext, type Summary } from "./stats";

const summary = (patch: Partial<Summary>): Summary => ({
  applied: 0,
  replied: 0,
  waiting: 0,
  responseRate: 0,
  medianReplyDays: null,
  ...patch,
});

describe("dashboard context lines", () => {
  test("a falling reply rate names the drop and the missing replies", () => {
    const line = replyRateContext(
      summary({ responseRate: 24, replied: 10 }),
      summary({ responseRate: 29, replied: 13 }),
    );
    expect(line).toBe("24% reply rate, down 5 pts — 3 fewer replies than last period");
  });

  test("a flat reply rate says so", () => {
    const line = replyRateContext(
      summary({ responseRate: 30, replied: 12 }),
      summary({ responseRate: 30, replied: 12 }),
    );
    expect(line).toBe("30% reply rate, unchanged — the same number of replies as last period");
  });

  test("one more reply is singular", () => {
    const line = replyRateContext(
      summary({ responseRate: 31, replied: 5 }),
      summary({ responseRate: 30, replied: 4 }),
    );
    expect(line).toBe("31% reply rate, up 1 pts — 1 more reply than last period");
  });

  test("applications compare against the period before", () => {
    expect(appliedContext(summary({ applied: 42 }), summary({ applied: 38 }))).toBe(
      "42 sent, up 4 — 4 more than last period",
    );
    expect(appliedContext(summary({ applied: 7 }), summary({ applied: 7 }))).toBe(
      "7 sent, the same as last period",
    );
  });
});
