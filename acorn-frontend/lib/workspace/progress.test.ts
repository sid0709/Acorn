import { describe, expect, test } from "bun:test";
import { RUNS_DAILY_MAX_DAYS, type RunDay } from "@acorn/shared/runs";
import { daysBetween } from "./dates";
import {
  PROGRESS_HISTORY_DAYS,
  countChange,
  dailyProgress,
  describeRun,
  fillDays,
  formatCost,
  formatWorked,
  historyWindow,
  summarizeProgress,
} from "./progress";

const TODAY = "2026-10-21";

const day = (
  date: string,
  count: number,
  durationMs = count * 90_000,
  costNanos = count * 20_000_000,
) => ({ day: date, count, durationMs, costNanos }) satisfies RunDay;

describe("the days the page asks acorn-backend for", () => {
  test("cover the longest range and the same length before it, within what the backend allows", () => {
    const window = historyWindow(TODAY);
    const span = daysBetween(window.from, window.to) + 1;
    expect(span).toBeGreaterThan(PROGRESS_HISTORY_DAYS);
    expect(span).toBeLessThanOrEqual(RUNS_DAILY_MAX_DAYS);
    expect(window.to).toBe("2026-10-22");
  });
});

describe("filling the days", () => {
  test("gives every day of the window, with the days that had nothing at zero", () => {
    const filled = fillDays([day("2026-10-19", 2)], { from: "2026-10-18", to: "2026-10-21" });
    expect(filled.map((entry) => [entry.day, entry.count])).toEqual([
      ["2026-10-18", 0],
      ["2026-10-19", 2],
      ["2026-10-20", 0],
      ["2026-10-21", 0],
    ]);
    expect(filled[0]).toEqual({ day: "2026-10-18", count: 0, durationMs: 0, costNanos: 0 });
  });
});

describe("summing a window", () => {
  const days = [day("2026-10-01", 1), day("2026-10-19", 2), day("2026-10-21", 3)];

  test("adds up only the days inside it", () => {
    const summary = summarizeProgress(days, { from: "2026-10-15", to: "2026-10-21" });
    expect(summary.sent).toBe(5);
    expect(summary.activeDays).toBe(2);
    expect(summary.durationMs).toBe(5 * 90_000);
    expect(summary.costNanos).toBe(5 * 20_000_000);
    expect(summary.avgDurationMs).toBe(90_000);
    expect(summary.avgCostNanos).toBe(20_000_000);
  });

  test("has no averages when nothing was sent", () => {
    const summary = summarizeProgress(days, { from: "2026-09-01", to: "2026-09-30" });
    expect(summary.sent).toBe(0);
    expect(summary.avgDurationMs).toBeNull();
    expect(summary.avgCostNanos).toBeNull();
  });
});

describe("daily progress for a range", () => {
  const days = [
    day("2026-10-12", 1),
    day("2026-10-13", 2),
    day("2026-10-14", 1),
    day("2026-10-20", 4),
    day("2026-10-21", 3),
    day("2026-09-10", 5),
    day("2026-08-01", 7),
  ];

  test("counts today and yesterday, and charts one point per day of the range", () => {
    const view = dailyProgress(days, TODAY, "30");
    expect(view.sentToday).toBe(3);
    expect(view.sentYesterday).toBe(4);
    expect(view.counts).toHaveLength(30);
    expect(view.labels).toHaveLength(30);
    expect(view.labels.at(-1)).toBe("Oct 21");
    expect(view.counts.at(-1)).toBe(3);
    expect(view.current.sent).toBe(11);
    expect(view.hasAny).toBe(true);
  });

  test("compares with the same length of time just before, and leaves older days out", () => {
    const view = dailyProgress(days, TODAY, "30");
    expect(view.previous.sent).toBe(5);
    expect(dailyProgress(days, TODAY, "180").current.sent).toBe(11 + 5 + 7);
  });

  test("finds the longest run of days in a row", () => {
    expect(dailyProgress(days, TODAY, "30").bestStreak).toBe(3);
  });

  test("says when nothing was ever counted", () => {
    const view = dailyProgress([], TODAY, "90");
    expect(view.hasAny).toBe(false);
    expect(view.sentToday).toBe(0);
    expect(view.counts.every((count) => count === 0)).toBe(true);
  });
});

describe("a change in a count", () => {
  test("reads as a signed number, and flat when nothing moved", () => {
    expect(countChange(5, 3)).toEqual({ value: "+2", direction: "up" });
    expect(countChange(1, 4)).toEqual({ value: "−3", direction: "down" });
    expect(countChange(2, 2)).toEqual({ value: "0", direction: "flat" });
  });
});

describe("money and time", () => {
  test("show dollars from nanodollars", () => {
    expect(formatCost(21_000_000)).toBe("$0.021");
    expect(formatCost(1_250_000_000)).toBe("$1.25");
    expect(formatCost(0)).toBe("$0.00000");
  });

  test("show a duration, or a dash with nothing to average", () => {
    expect(formatWorked(93_000)).toBe("1m 33s");
    expect(formatWorked(null)).toBe("—");
  });
});

describe("what the table shows for a job", () => {
  test("names the job by its title and where it is, without the query", () => {
    expect(
      describeRun({
        title: "Senior Engineer",
        url: "https://boards.example.com/acme/jobs/42?gh_jid=42",
      }),
    ).toEqual({
      title: "Senior Engineer",
      where: "boards.example.com/acme/jobs/42",
      href: "https://boards.example.com/acme/jobs/42?gh_jid=42",
    });
  });

  test("falls back to the site when the page had no title", () => {
    expect(describeRun({ title: "", url: "https://jobs.example.com/" })).toEqual({
      title: "jobs.example.com",
      where: "jobs.example.com",
      href: "https://jobs.example.com/",
    });
  });

  test("makes no link of an address a person cannot open", () => {
    for (const url of ["", "javascript:alert(1)", "data:text/html,x", "not a url"]) {
      const label = describeRun({ title: "A job", url });
      expect(label.href).toBeNull();
      expect(label.where).toBe("");
      expect(label.title).toBe("A job");
    }
    expect(describeRun({ title: "", url: "" }).title).toBe("Untitled job");
  });
});
