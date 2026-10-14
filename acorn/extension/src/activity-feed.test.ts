import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildActivityFeed, latestRunItems } from "./activity-feed.ts";

import type { TabLogEntry } from "./tab-log-session.ts";

let sequence = 0;
const entry = (
  patch: Partial<TabLogEntry> & Pick<TabLogEntry, "kind" | "title">,
  data: unknown = {},
): TabLogEntry => {
  sequence += 1;
  return {
    id: `e${sequence}`,
    t: 1_000 + sequence * 100,
    text: typeof data === "string" ? data : JSON.stringify(data),
    runId: "r1",
    ...patch,
  };
};
const event = (name: string, data: unknown = {}, patch: Partial<TabLogEntry> = {}) =>
  entry({ kind: "event", title: `background · run:${name}`, ...patch }, data);

describe("buildActivityFeed", () => {
  it("tells a backend call as one item that runs, then answers", () => {
    const request = entry(
      { kind: "api", title: "→ POST run/read-page", group: "run/read-page#1" },
      {},
    );
    const running = buildActivityFeed([request], request.t + 1);
    assert.equal(running[0].status, "running");
    assert.match(running[0].title, /Asking the AI to read the page/);

    const answer = entry(
      { kind: "api", title: "← run/read-page · 200 · 3217 ms", group: "run/read-page#1", ms: 3217 },
      {
        status: 200,
        body: {
          kind: "application_form",
          kindConfidence: 0.97,
          control: { role: "submit", confidence: 0.88 },
          verification: "other",
        },
      },
    );
    const done = buildActivityFeed([request, answer], answer.t + 1);
    assert.equal(done.length, 1);
    assert.equal(done[0].status, "ok");
    assert.equal(done[0].ms, 3217);
    assert.match(done[0].summary ?? "", /application form \(97%\)/);
    assert.match(done[0].summary ?? "", /verification: other/);
    assert.deepEqual(done[0].entryIds, [request.id, answer.id]);
  });

  it("shows a refused call as a warning with the server's words", () => {
    const request = entry({
      kind: "api",
      title: "→ POST ai-analyze · fast",
      group: "ai-analyze · fast#2",
    });
    const answer = entry(
      {
        kind: "api",
        title: "← ai-analyze · fast · 402",
        group: "ai-analyze · fast#2",
        level: "warn",
      },
      { status: 402, body: { error: "insufficient credits" } },
    );
    const [item] = buildActivityFeed([request, answer]);
    assert.equal(item.status, "warn");
    assert.match(item.title, /refused \(402\)/);
    assert.equal(item.summary, "insufficient credits");
  });

  it("shows a call that never got an answer as an error", () => {
    const request = entry({ kind: "api", title: "→ POST run/read-page", group: "run/read-page#3" });
    const lost = entry(
      {
        kind: "error",
        title: "✕ run/read-page · no answer · 40 ms",
        group: "run/read-page#3",
        level: "error",
      },
      { cause: "Could not reach the Acorn server" },
    );
    const [item] = buildActivityFeed([request, lost]);
    assert.equal(item.status, "error");
    assert.match(item.title, /no answer/);
    assert.equal(item.summary, "Could not reach the Acorn server");
  });

  it("names a click and what the page did after it", () => {
    const items = buildActivityFeed([
      event("click", { text: "Submit Application", ok: true }),
      event("settled", { how: "navigated" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Clicked "Submit Application"');
    assert.equal(items[0].summary, "The page went to a new address");
  });

  it("folds step results into one filling item and finishes it with the fill", () => {
    const steps = [true, true, false].map((ok) =>
      entry({ kind: "event", title: "background · step:result" }, { ok }),
    );
    const mid = buildActivityFeed(steps, steps[2].t + 1);
    assert.equal(mid.length, 1);
    assert.equal(mid[0].status, "running");
    assert.equal(mid[0].summary, "2 done, 1 did not work");
    const done = buildActivityFeed([
      ...steps,
      event("fill:done", { ok: true, durationMs: 4200, message: "Done · 2 ok" }),
    ]);
    assert.equal(done.length, 1);
    assert.equal(done[0].title, "Filled the form");
    assert.equal(done[0].ms, 4200);
  });

  it("counts repeated mail looks as one item and ends it when the email is found", () => {
    const looks = [1, 2, 3].map(() => event("mail:look", { status: "pending" }));
    const waiting = buildActivityFeed(looks, looks[2].t + 1);
    assert.equal(waiting.length, 1);
    assert.match(waiting[0].title, /3 times/);
    const found = buildActivityFeed([...looks, event("mail:look", { status: "found" })]);
    assert.equal(found.length, 1);
    assert.equal(found[0].title, "Found the site's email");
    assert.equal(found[0].status, "ok");
  });

  it("explains a wait for the applicant from its decision, and skips the click decision", () => {
    const items = buildActivityFeed([
      entry({ kind: "decision", title: 'Click "Apply"' }, { what: 'Click "Apply"', why: "x" }),
      entry(
        { kind: "decision", title: "Wait for the applicant", level: "warn" },
        { what: "Wait for the applicant", why: "The model answered verification: other." },
      ),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Wait for the applicant");
    assert.equal(items[0].status, "warn");
    assert.match(items[0].summary ?? "", /verification: other/);
  });

  it("closes the story with how the run ended", () => {
    const [item] = buildActivityFeed([
      event("run:end", { outcome: "failed", reason: "no_progress", seconds: 12 }),
    ]);
    assert.equal(item.title, "The run stopped");
    assert.equal(item.status, "error");
    assert.equal(item.ms, 12_000);
  });

  it("stops showing an old item as running", () => {
    const request = entry({ kind: "api", title: "→ POST qa", group: "qa#4" });
    const [item] = buildActivityFeed([request], request.t + 500_000);
    assert.equal(item.status, "warn");
    assert.match(item.title, /no answer logged/);
  });
});

describe("latestRunItems", () => {
  it("keeps only the newest run", () => {
    const first = event("click", { text: "A" }, { runId: "old" });
    const second = event("click", { text: "B" }, { runId: "new" });
    const items = latestRunItems(buildActivityFeed([first, second]));
    assert.deepEqual(
      items.map((item) => item.runId),
      ["new"],
    );
  });
});

describe("the run on the clock", () => {
  const at = (
    t: number,
    patch: Partial<TabLogEntry> & Pick<TabLogEntry, "kind" | "title">,
    data: unknown = {},
  ) => entry({ t, ...patch }, data);

  it("lists the steps in the order they happened, whatever order the log holds them", () => {
    const later = at(5_000, { kind: "event", title: "background · run:click" }, { text: "B" });
    const earlier = at(1_000, { kind: "event", title: "background · run:click" }, { text: "A" });
    const items = buildActivityFeed([later, earlier], 6_000);
    assert.deepEqual(
      items.filter((item) => !item.synthetic).map((item) => item.title),
      ['Clicked "A"', 'Clicked "B"'],
    );
  });

  it("shows time that no step accounts for as a Waiting row", () => {
    const first = at(1_000, { kind: "event", title: "background · run:click" }, { text: "A" });
    const settled = at(
      1_500,
      { kind: "event", title: "background · run:settled" },
      { how: "navigated" },
    );
    const second = at(9_500, { kind: "event", title: "background · run:click" }, { text: "B" });
    const items = buildActivityFeed([first, settled, second], 10_000);
    const gap = items.find((item) => item.synthetic === "gap");
    assert.ok(gap, "a gap row");
    assert.equal(gap.ms, 8_000);
    assert.equal(gap.title, "Waiting");
  });

  it("nests what happened during the fill under it, so durations are not counted twice", () => {
    const plan = at(2_000, {
      kind: "api",
      title: "→ POST ai-analyze · fast",
      group: "ai-analyze · fast#1",
    });
    const planned = at(
      8_000,
      { kind: "api", title: "← ai-analyze · fast · 200", group: "ai-analyze · fast#1", ms: 6_000 },
      { status: 200, body: { plan: "(14 actions)" } },
    );
    const step = at(9_000, { kind: "event", title: "background · step:result" }, { ok: true });
    const done = at(
      20_000,
      { kind: "event", title: "background · run:fill:done" },
      { ok: true, durationMs: 19_000 },
    );
    const items = buildActivityFeed([plan, planned, step, done], 21_000);
    const fill = items.find((item) => item.title === "Filled the form");
    const call = items.find((item) => item.title.startsWith("Planned"));
    assert.equal(fill?.startedAt, 1_000);
    assert.equal(fill?.depth ?? 0, 0);
    assert.equal(call?.depth, 1);
    assert.equal(items.filter((item) => item.synthetic).length, 0);
  });

  it("lets the click own the wait for the page, and the run end own the whole list of times", () => {
    const click = at(1_000, { kind: "event", title: "background · run:click" }, { text: "Submit" });
    const settled = at(
      4_000,
      { kind: "event", title: "background · run:settled" },
      { how: "navigated" },
    );
    const end = at(
      10_000,
      { kind: "event", title: "background · run:run:end" },
      { outcome: "completed", seconds: 10, phases: { fill: 4_000, decide: 3_000, click: 2_000 } },
    );
    const items = buildActivityFeed([click, settled, end], 11_000);
    assert.equal(items.find((item) => item.title.startsWith("Clicked"))?.ms, 3_000);
    const last = items.at(-1);
    assert.equal(last?.title, "Application sent");
    const shares = last?.breakdown ?? [];
    assert.equal(
      shares.reduce((sum, share) => sum + share.ms, 0),
      10_000,
    );
    assert.match(shares.at(-1)?.label ?? "", /Not measured/);
    assert.equal(shares[0].label, "Filling the form");
  });
});
