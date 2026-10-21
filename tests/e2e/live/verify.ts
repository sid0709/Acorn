// Checks the live runner itself against the fake site of ../agent, with a stand-in for the model and the
// decision model, so no real model is called and no real link is opened: the runner's own path (the
// queue, the health refusal, the outcomes, the trace numbers, the report) is what is under test.
//
//   bun tests/e2e/live/verify.ts
//
// It starts the fake site and the fake models, writes a link file that expects one job to be unavailable
// and one to end ready, runs run.ts as a child with the agent pointed at the fakes, and reads back
// results.json. The agent still reads acorn-agent/.env, but every setting that matters is overridden here.
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  answer,
  click,
  commit,
  startFakeDecisions,
  startFakeModel,
  typeInto,
  upload,
} from "../agent/fake-model";
import { startAgentSite } from "../agent/site";

import type { Results } from "./report";

const site = startAgentSite();
const siteUrl = `http://127.0.0.1:${site.port}/`;
/** The fake model never gets a page's points here; the guard holds the send wherever it points. */
const anywhere = { x: 400, y: 300 };
const model = startFakeModel(
  () => ({
    name: anywhere,
    email: anywhere,
    auth: anywhere,
    agree: anywhere,
    upload: anywhere,
    submit: anywhere,
    send: anywhere,
  }),
  (step, at, _survey, look) => {
    if (look?.url.includes("/expired")) {
      return answer({
        status: "stuck",
        message: "This job is closed",
        stop: {
          reason: "job_unavailable",
          kind: "expired",
          problem: "The posting says this position has been filled.",
          action: "Try another job.",
        },
      });
    }
    if (look?.url.includes("captcha")) {
      return answer({
        status: "need_person",
        message: "Solve the CAPTCHA",
        stop: {
          reason: "captcha",
          problem: "The page asks you to prove you're not a robot.",
          action: "Tick the box.",
        },
      });
    }
    switch (step) {
      case 1:
        return answer({
          status: "working",
          message: "Filling the form",
          actions: [
            click(at.name),
            typeInto("Ada Lovelace"),
            click(at.email),
            typeInto("ada@example.com"),
            upload(at.upload),
          ],
        });
      default:
        return answer({
          status: "working",
          message: "Sending",
          actions: [commit(at.submit, "send")],
        });
    }
  },
);
const decisions = startFakeDecisions(() => ({ matches: 0.98, blocked: 0.01, loading: 0.01 }));

const dataDir = await mkdtemp(join(tmpdir(), "acorn-live-verify-data-"));
await mkdir(join(dataDir, "resumes", "Backend"), { recursive: true });
await writeFile(
  join(dataDir, "profile.json"),
  JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com" }),
);
await writeFile(
  join(dataDir, "resumes", "Backend", "Ada-Lovelace.pdf"),
  "%PDF-1.4 a résumé for the test",
);
const outDir = await mkdtemp(join(tmpdir(), "acorn-live-verify-out-"));
const linksFile = join(outDir, "links.txt");
await writeFile(
  linksFile,
  [
    "# the fake site",
    `${siteUrl}expired expect=unavailable`,
    `${siteUrl}?jd=1 expect=ready`,
    `${siteUrl}?jd=1&captcha=1 expect=need_person`,
  ].join("\n"),
);

const failures: string[] = [];
const check = (ok: boolean, what: string, detail?: unknown) => {
  console.log(
    `${ok ? "ok  " : "FAIL"} ${what}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`,
  );
  if (!ok) failures.push(what);
};

try {
  const run = Bun.spawn(
    [
      "bun",
      join(import.meta.dir, "run.ts"),
      "--links",
      linksFile,
      "--repeat",
      "2",
      "--out",
      outDir,
    ],
    {
      env: {
        ...process.env,
        OPENROUTER_API_KEY: "e2e-not-a-real-key",
        OPENROUTER_BASE_URL: `http://127.0.0.1:${model.port}`,
        ACORN_AGENT_DECISIONS_URL: `http://127.0.0.1:${decisions.port}/`,
        ACORN_AGENT_DATA_DIR: dataDir,
        DEFAULT_FALLBACK_RESUME: "Backend",
        ACORN_AGENT_REASONING: "none",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const code = await run.exited;
  check(code === 0, "the runner exits 0 when nothing was sent", code);
  const results = JSON.parse(await readFile(join(outDir, "results.json"), "utf8")) as Results;
  const report = await readFile(join(outDir, "report.md"), "utf8");
  check(results.attempts.length === 6, "every link was tried twice", results.attempts.length);
  const outcomes = results.attempts
    .map((a) => `${a.line}:${a.outcome}${a.kind ? `/${a.kind}` : ""}`)
    .sort();
  check(
    JSON.stringify(outcomes) ===
      JSON.stringify([
        "2:unavailable/expired",
        "2:unavailable/expired",
        "3:ready",
        "3:ready",
        "4:need_person",
        "4:need_person",
      ]),
    "the expired job is unavailable, the form ends ready, the CAPTCHA page needs the person",
    outcomes,
  );
  check(results.summary.outcomes.sent === 0, "nothing was sent", results.summary.outcomes);
  check(
    results.summary.matched === 6 && results.summary.unavailableAccuracy === 1,
    "every expectation matched",
    results.summary,
  );
  check(
    results.attempts.every((a) => a.traceDir && a.modelCalls >= 1 && a.cost > 0 && a.seconds > 0),
    "each attempt has its trace folder, its model calls, its cost and its time",
    results.attempts.map((a) => [a.traceDir, a.modelCalls, a.cost, a.seconds]),
  );
  check(
    results.attempts.filter((a) => a.line === 3).every((a) => a.modelCalls === 2),
    "the form took two model calls: the fill, then the held send",
    results.attempts.filter((a) => a.line === 3).map((a) => a.modelCalls),
  );
  check(
    report.includes("| **All** |") && report.includes("Other") && report.includes("ready"),
    "the report has its tables",
    report.slice(0, 400),
  );

  // A baseline: the same results compared with themselves show no arrows.
  const again = Bun.spawnSync(
    [
      "bun",
      join(import.meta.dir, "run.ts"),
      "--links",
      linksFile,
      "--only",
      "127.0.0.1",
      "--baseline",
      join(outDir, "results.json"),
      "--out",
      join(outDir, "again"),
    ],
    {
      env: {
        ...process.env,
        OPENROUTER_API_KEY: "e2e-not-a-real-key",
        OPENROUTER_BASE_URL: `http://127.0.0.1:${model.port}`,
        ACORN_AGENT_DECISIONS_URL: `http://127.0.0.1:${decisions.port}/`,
        ACORN_AGENT_DATA_DIR: dataDir,
        DEFAULT_FALLBACK_RESUME: "Backend",
        ACORN_AGENT_REASONING: "none",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  check(
    again.exitCode === 0,
    "a second run with --only and --baseline exits 0",
    again.stderr.toString().slice(-600),
  );
  const compared = await readFile(join(outDir, "again", "report.md"), "utf8").catch(() => "");
  check(
    compared.includes("Compared with the run of") && /\d+ → \d+/.test(compared),
    "the report shows before → after against the baseline",
    compared.slice(0, 300),
  );
  console.log(`\nresults in ${outDir}`);
} catch (err) {
  console.error(err);
  failures.push(`threw: ${String(err)}`);
} finally {
  void site.stop();
  void model.stop();
  void decisions.stop();
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall checks passed");
