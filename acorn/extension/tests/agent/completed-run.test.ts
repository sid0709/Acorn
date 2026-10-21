import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RUN_TITLE_MAX, RUN_URL_MAX } from "@acorn/shared/runs";

import {
  buildCompletedRun,
  jobLink,
  jobTitle,
  utcOffsetMinutesAt,
  workedMs,
} from "../../src/agent/completed-run.ts";

describe("the link of a job", () => {
  it("keeps the query, which often names the job, and drops the fragment and any sign-in", () => {
    assert.equal(
      jobLink("https://boards.example.com/acme/jobs/42?gh_jid=42&utm=x#apply"),
      "https://boards.example.com/acme/jobs/42?gh_jid=42&utm=x",
    );
    assert.equal(jobLink("https://user:secret@jobs.example.com/a"), "https://jobs.example.com/a");
  });

  it("is empty for what a person cannot open", () => {
    for (const raw of [
      "",
      "not a url",
      "javascript:alert(1)",
      "chrome://extensions",
      "file:///a",
    ]) {
      assert.equal(jobLink(raw), "", raw);
    }
  });

  it("drops the query before it gives up on a link that is too long", () => {
    const long = `https://jobs.example.com/a?x=${"q".repeat(RUN_URL_MAX)}`;
    assert.equal(jobLink(long), "https://jobs.example.com/a");
    assert.equal(jobLink(`https://jobs.example.com/${"p".repeat(RUN_URL_MAX)}`), "");
  });
});

describe("the title of a job", () => {
  it("is on one line and cut without splitting a character", () => {
    assert.equal(jobTitle("  Staff\n  Engineer \t at Acme "), "Staff Engineer at Acme");
    const cut = jobTitle("🙂".repeat(RUN_TITLE_MAX + 20));
    assert.equal(Array.from(cut).length, RUN_TITLE_MAX);
    assert.ok(!cut.includes("�"));
  });
});

describe("how long a Run worked", () => {
  it("is the legs added up, less the time it waited for the person", () => {
    assert.equal(
      workedMs({ carriedMs: 40_000, startedAt: 1_000, endedAt: 61_000, waitedOnPersonMs: 15_000 }),
      85_000,
    );
  });

  it("is one leg when nothing was carried, and never negative", () => {
    assert.equal(
      workedMs({ carriedMs: 0, startedAt: 1_000, endedAt: 31_000, waitedOnPersonMs: 0 }),
      30_000,
    );
    assert.equal(
      workedMs({ carriedMs: 0, startedAt: 1_000, endedAt: 2_000, waitedOnPersonMs: 9_000 }),
      0,
    );
  });
});

describe("the offset the backend reads the day from", () => {
  it("is minutes east of UTC on this computer's clock, with no negative zero", () => {
    const at = Date.UTC(2026, 9, 21, 12, 0, 0);
    assert.equal(utcOffsetMinutesAt(at), 0 - new Date(at).getTimezoneOffset());
    assert.ok(!Object.is(utcOffsetMinutesAt(at), -0));
  });
});

describe("the record of a completed Run", () => {
  const input = {
    runId: "ab12cd34",
    job: { url: "https://boards.example.com/acme/jobs/42#apply", title: " Senior   Engineer " },
    endedAt: Date.UTC(2026, 9, 21, 12, 0, 0),
    workMs: 93_000,
    costUsd: 0.0215,
    steps: 19,
    usage: { calls: 21, inputTokens: 0, outputTokens: 0, cost: 0.0215, checks: 3 },
  };

  it("carries the link, the time and the money", () => {
    const record = buildCompletedRun(input);
    assert.equal(record.runId, "ab12cd34");
    assert.equal(record.url, "https://boards.example.com/acme/jobs/42");
    assert.equal(record.title, "Senior Engineer");
    assert.equal(record.endedAt, input.endedAt);
    assert.equal(record.durationMs, 93_000);
    assert.equal(record.costNanos, 21_500_000);
    assert.equal(record.steps, 19);
    assert.equal(record.modelCalls, 21);
    assert.equal(record.screenChecks, 3);
    assert.equal(record.utcOffsetMinutes, utcOffsetMinutesAt(input.endedAt));
  });

  it("is a new record every time, so two Runs are never taken for one", () => {
    assert.notEqual(buildCompletedRun(input).recordId, buildCompletedRun(input).recordId);
    assert.match(buildCompletedRun(input).recordId, /^[0-9a-f-]{36}$/);
  });

  it("counts a Run that cost nothing or has no usage as free, not as missing", () => {
    const record = buildCompletedRun({ ...input, costUsd: Number.NaN, usage: null });
    assert.equal(record.costNanos, 0);
    assert.equal(record.modelCalls, 0);
    assert.equal(record.screenChecks, 0);
  });
});
