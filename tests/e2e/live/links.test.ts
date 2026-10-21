import { describe, expect, it } from "bun:test";

import { LinkFileError, onlyHost, parseLinkFile } from "./links";
import { median, summarize, type AttemptResult } from "./report";
import { siteSystem } from "./site-system";

describe("the link file", () => {
  it("reads one link per line, with comments and an expected outcome", () => {
    const links = parseLinkFile(
      [
        "# jobs to measure",
        "https://acme.myworkdayjobs.com/en-US/jobs/1  expect=ready",
        "",
        "https://boards.greenhouse.io/acme/jobs/2 # closed last week",
        "https://example.com/careers expect=unavailable  # home page",
      ].join("\n"),
    );
    expect(links.map((l) => [l.line, l.host, l.expect])).toEqual([
      [2, "acme.myworkdayjobs.com", "ready"],
      [4, "boards.greenhouse.io", undefined],
      [5, "example.com", "unavailable"],
    ]);
  });

  it("says which line is wrong", () => {
    expect(() => parseLinkFile("https://a.example/1\nnot a link")).toThrow(
      new LinkFileError(2, '"not" is not an http or https link').message,
    );
    expect(() => parseLinkFile("https://a.example/1 expect=sent")).toThrow(/line 1: expect=sent/);
    expect(() => parseLinkFile("https://a.example/1 tries=3")).toThrow(/line 1: unknown option/);
    expect(() => parseLinkFile("https://a.example/1\n\nhttps://a.example/1")).toThrow(
      /line 3: repeats the link of line 1/,
    );
  });

  it("keeps only the hosts asked for", () => {
    const links = parseLinkFile("https://acme.myworkdayjobs.com/1\nhttps://jobs.lever.co/acme/2");
    expect(onlyHost(links, "Workday").map((l) => l.host)).toEqual(["acme.myworkdayjobs.com"]);
    expect(onlyHost(links, undefined)).toHaveLength(2);
  });
});

describe("the site system", () => {
  it("is guessed from the host for grouping only", () => {
    expect(siteSystem("acme.wd5.myworkdayjobs.com")).toBe("Workday");
    expect(siteSystem("job-boards.greenhouse.io")).toBe("Greenhouse");
    expect(siteSystem("127.0.0.1:4321")).toBe("Other");
  });
});

function attempt(partial: Partial<AttemptResult>): AttemptResult {
  return {
    line: 1,
    url: "https://a.example/1",
    host: "a.example",
    system: "Other",
    attempt: 1,
    outcome: "ready",
    message: "",
    seconds: 60,
    modelCalls: 5,
    decisionCalls: 2,
    inputTokens: 1000,
    cachedTokens: 800,
    outputTokens: 100,
    cost: 0.01,
    requiredEmpty: 0,
    startedAt: "",
    endedAt: "",
    ...partial,
  };
}

describe("the summary", () => {
  it("counts outcomes, the ready rate, the unavailable accuracy and the medians", () => {
    const summary = summarize([
      attempt({ seconds: 30, cost: 0.01 }),
      attempt({
        outcome: "unavailable",
        expect: "unavailable",
        matched: true,
        seconds: 10,
        cost: 0.002,
      }),
      attempt({
        outcome: "unavailable",
        expect: "ready",
        matched: false,
        seconds: 20,
        cost: 0.004,
      }),
      attempt({ outcome: "stuck", seconds: 90, cost: 0.03 }),
    ]);
    expect(summary.attempts).toBe(4);
    expect(summary.outcomes.ready).toBe(1);
    expect(summary.readyRate).toBe(0.25);
    expect(summary.expected).toBe(2);
    expect(summary.matched).toBe(1);
    expect(summary.unavailableAccuracy).toBe(1);
    expect(summary.unavailableUnexpected).toBe(1);
    expect(summary.medianSeconds).toBe(25);
    expect(summary.medianCost).toBe(0.007);
    expect(summarize([]).unavailableAccuracy).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
  });
});
