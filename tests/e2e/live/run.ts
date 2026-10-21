// Runs every link of a file through the real extension in a real Chrome with the real agent and the real
// models, the way the Agent tab does: the links go into the Agent Mode queue and the queue works them one
// at a time. Whether applications are sent follows the agent's own setting (ACORN_AGENT_STOP_BEFORE_SUBMIT
// in acorn-agent/.env): with it on, every run stops at the control that sends and a "sent" outcome is a
// passed guard, flagged loudly; with it off, the agent sends applications and "sent" is the result hoped
// for. The health route says which, and the runner prints it before the first link. It writes results.json
// and report.md to compare one change of the agent against another.
//
//   bun run e2e:live -- --links test-link.txt [--repeat 2] [--only workday] [--baseline logs/live/<earlier>/results.json] [--out logs/live/<name>] [--profile logs/live/chrome-profile]
//
// The link file is the Agent tab's own format: one URL per line, only the text before the first space is
// the link, `#` starts a comment line, and `expect=<outcome>` after a URL says how the run there should end
// (ready, unavailable, need_person, stuck, step_limit, error). The agent reads its settings and the
// OpenRouter key from acorn-agent/.env, which is never printed or written. The applicant is whatever
// that file names: the signed-in person's account when ACORN_AGENT_BACKEND_URL is set (then the extension
// in the test Chrome must be signed in: the runner waits for you to do it, and `--profile <dir>` keeps the
// Chrome profile so one sign-in lasts), else the local profile.json and résumés (acorn-agent/data unless
// ACORN_AGENT_DATA_DIR says otherwise).
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { QUEUE_ACTION } from "../../../acorn/extension/src/agent-queue/actions";
import { QUEUE_ITEM, QUEUE_MODE } from "../../../acorn/extension/src/agent-queue/model";
import { AGENT_QUEUE_STORAGE_KEY } from "../../../acorn/extension/src/agent-queue/store";
import { STORAGE_KEYS } from "../../../acorn/extension/src/auth/storage-keys";
import { TAB_PIPELINES_STORAGE_KEY } from "../../../acorn/extension/src/tab-pipeline-session";
import { MSG } from "../../../acorn/extension/src/types";
import { AGENT_STOP_REASON } from "../../../acorn/packages/shared/agent-contract";
import { RUN_FAILURE_REASON, RUN_OUTCOME } from "../../../acorn/packages/shared/run-types";
import {
  AGENT_DIR,
  agentHealth,
  buildAgent,
  buildExtension,
  freePort,
  launchChrome,
  openControlPage,
  pause,
  startAgent,
} from "../agent/harness";

import {
  LinkFileError,
  OUTCOME,
  onlyHost,
  parseLinkFile,
  type LinkEntry,
  type Outcome,
} from "./links";
import { bySystem, renderReport, summarize, type AttemptResult, type Results } from "./report";
import { siteSystem } from "./site-system";

import type { QueueItem, QueueState } from "../../../acorn/extension/src/agent-queue/model";
import type { PipelineProgress } from "../../../acorn/packages/shared/pipeline-types";
import type { RunMapControl } from "../../../acorn/packages/shared/run-types";
import type { Page } from "puppeteer";

const REPO_ROOT = join(import.meta.dir, "../../..");
/** Where a run's folder goes unless --out says: the repo's ignored logs folder. */
const DEFAULT_OUT_ROOT = join(REPO_ROOT, "logs", "live");
/** The most one link gets, from its tab opening to its run ending; past it the job is skipped. */
const LINK_TIMEOUT_MS = 12 * 60_000;
/** How often the queue is read while a job works. */
const QUEUE_POLL_MS = 500;
/** A trace folder begun this long before a job's Run started may still be its (clocks and storage lag). */
const TRACE_START_SLACK_MS = 5_000;
/** The agent's trace folder, under --out. */
const TRACES_DIR_NAME = "traces";
/** How long the runner waits for you to sign the extension in, when the agent reads the applicant's account. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const SIGN_IN_POLL_MS = 2_000;
/** The queue statuses an attempt is over at. */
const TERMINAL: ReadonlySet<string> = new Set([
  QUEUE_ITEM.done,
  QUEUE_ITEM.ready,
  QUEUE_ITEM.unavailable,
  QUEUE_ITEM.skipped,
]);

type Args = {
  links: string;
  repeat: number;
  only?: string;
  baseline?: string;
  out?: string;
  /** A Chrome profile folder kept between runs, so a sign-in to Acorn lasts. */
  profile?: string;
};

function usage(message: string): never {
  console.error(
    `${message}\n\nusage: bun tests/e2e/live/run.ts --links <file> [--repeat <n>] [--only <host part>] [--baseline <results.json>] [--out <dir>] [--profile <chrome profile dir>]`,
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { repeat: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag.startsWith("--")) usage(`unexpected argument ${flag}`);
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    i += 1;
    switch (flag) {
      case "--links":
        args.links = value;
        break;
      case "--repeat": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1)
          usage(`--repeat needs a whole number from 1, not ${value}`);
        args.repeat = n;
        break;
      }
      case "--only":
        args.only = value;
        break;
      case "--baseline":
        args.baseline = value;
        break;
      case "--out":
        args.out = value;
        break;
      case "--profile":
        args.profile = value;
        break;
      default:
        usage(`unknown option ${flag}`);
    }
  }
  if (!args.links) usage("--links <file> is required");
  return args as Args;
}

/** A folder name from the clock: 20261021-143005. */
function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Reads one setting from acorn-agent/.env without touching any other line (the key is never read). */
async function envFileSetting(name: string): Promise<string | undefined> {
  const text = await readFile(join(AGENT_DIR, ".env"), "utf8").catch(() => "");
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split("=");
    if (key.trim() === name)
      return rest
        .join("=")
        .trim()
        .replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** What the runner knows of one trace folder: when the run began, where. */
type TraceFolder = { dir: string; started: number; url: string };

async function traceFolders(tracesDir: string): Promise<TraceFolder[]> {
  const names = await readdir(tracesDir).catch(() => [] as string[]);
  const folders: TraceFolder[] = [];
  for (const name of names) {
    const dir = join(tracesDir, name);
    try {
      const session = JSON.parse(await readFile(join(dir, "session.json"), "utf8")) as {
        started?: string;
        start?: { url?: string };
      };
      folders.push({
        dir,
        started: Date.parse(session.started ?? "") || 0,
        url: session.start?.url ?? "",
      });
    } catch {
      /* not a run yet */
    }
  }
  return folders.sort((a, b) => a.started - b.started);
}

/** tracesum's -json for one folder: the numbers the report shows, read from the trace, not from its text. */
type TraceSummary = {
  wallMs: number;
  modelCalls: number;
  checks: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalCost: number;
  status: string;
  message: string;
  readyToSubmit: boolean;
  stop?: { reason: string; kind?: string; problem: string };
};

function traceSummary(dir: string): TraceSummary | null {
  const result = Bun.spawnSync(["go", "run", "./cmd/tracesum", "-json", dir], {
    cwd: AGENT_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    console.error(`tracesum failed for ${dir}: ${result.stderr.toString().trim()}`);
    return null;
  }
  const parsed = JSON.parse(result.stdout.toString()) as TraceSummary[];
  return parsed[0] ?? null;
}

/** How the run ended, in the report's words, from the extension's report of it. */
function outcomeOf(progress: PipelineProgress | undefined): {
  outcome: Outcome;
  kind?: string;
  stopReason?: string;
  message: string;
} {
  const report = progress?.run?.report;
  const message = progress?.message ?? "";
  if (!report) return { outcome: OUTCOME.error, message: message || "the run gave no report" };
  const failure = report.failure;
  const stop = failure?.agentStop;
  switch (report.outcome) {
    case RUN_OUTCOME.completed:
      return { outcome: OUTCOME.sent, message };
    case RUN_OUTCOME.readyToSubmit:
      return { outcome: OUTCOME.ready, message };
    case RUN_OUTCOME.stopped:
      return { outcome: OUTCOME.error, message: failure?.label ?? "stopped" };
    default:
      break;
  }
  const said = [failure?.label, failure?.detail].filter(Boolean).join(": ") || message;
  if (stop?.reason === AGENT_STOP_REASON.jobUnavailable) {
    return {
      outcome: OUTCOME.unavailable,
      kind: stop.kind,
      stopReason: stop.reason,
      message: said,
    };
  }
  if (stop?.reason === AGENT_STOP_REASON.stepLimit) {
    return { outcome: OUTCOME.stepLimit, stopReason: stop.reason, message: said };
  }
  if (
    failure?.reason === RUN_FAILURE_REASON.waitedForPerson ||
    failure?.reason === RUN_FAILURE_REASON.verificationNotFound ||
    failure?.reason === RUN_FAILURE_REASON.mailUnreadable
  ) {
    return { outcome: OUTCOME.needPerson, stopReason: stop?.reason, message: said };
  }
  if (stop) return { outcome: OUTCOME.stuck, stopReason: stop.reason, message: said };
  return { outcome: OUTCOME.error, message: said };
}

/** Required fields the page still reported empty or invalid when the run stopped, a group counted once. */
function requiredEmpty(controls: RunMapControl[] | undefined): number {
  if (!controls) return 0;
  const groups = new Set<string>();
  let count = 0;
  for (const control of controls) {
    if (!control.required) continue;
    const unfilled =
      control.invalid === true || control.empty === true || control.checked === false;
    if (!unfilled) continue;
    if (control.group) {
      if (groups.has(control.group)) continue;
      // A group is empty only when none of it is ticked.
      if (controls.some((c) => c.group === control.group && c.checked === true)) continue;
      groups.add(control.group);
    }
    count += 1;
  }
  return count;
}

const args = parseArgs(process.argv.slice(2));
const linksFile = resolve(args.links);
let links: LinkEntry[];
try {
  links = onlyHost(parseLinkFile(await readFile(linksFile, "utf8")), args.only);
} catch (err) {
  if (err instanceof LinkFileError) usage(`${linksFile}: ${err.message}`);
  usage(`cannot read ${linksFile}: ${err instanceof Error ? err.message : String(err)}`);
}
if (links.length === 0)
  usage(`no links to run${args.only ? ` whose host holds ${JSON.stringify(args.only)}` : ""}`);

const baseline: Results | undefined = args.baseline
  ? (JSON.parse(await readFile(resolve(args.baseline), "utf8")) as Results)
  : undefined;

const startedAt = new Date();
const outDir = resolve(args.out ?? join(DEFAULT_OUT_ROOT, stamp(startedAt)));
const tracesDir = join(outDir, TRACES_DIR_NAME);
await mkdir(tracesDir, { recursive: true });

// The applicant comes from where acorn-agent/.env says: the signed-in person's account (ACORN_AGENT_BACKEND_URL)
// or the local files, which must then hold a profile, or every run would fail the same way.
const backendUrl =
  process.env.ACORN_AGENT_BACKEND_URL ?? (await envFileSetting("ACORN_AGENT_BACKEND_URL")) ?? "";
const dataDir = resolve(
  AGENT_DIR,
  process.env.ACORN_AGENT_DATA_DIR ?? (await envFileSetting("ACORN_AGENT_DATA_DIR")) ?? "data",
);
if (!backendUrl && !(await Bun.file(join(dataDir, "profile.json")).exists())) {
  console.error(`no applicant: ${join(dataDir, "profile.json")} does not exist`);
  process.exit(2);
}

console.log(`${links.length} link(s) × ${args.repeat}, results in ${relative(REPO_ROOT, outDir)}`);
const AGENT_URL = `http://127.0.0.1:${freePort()}`;
console.log("Building the extension and the agent…");
const extensionDir = await buildExtension(AGENT_URL);
const binary = join(await mkdtemp(join(tmpdir(), "acorn-live-agent-")), "agent");
buildAgent(binary);
// The agent reads acorn-agent/.env from its working directory (the key, the models, the settings, where the
// applicant comes from); what is set here wins over the file.
const agent = await startAgent(
  binary,
  AGENT_URL,
  {
    ACORN_AGENT_TRACE: "true",
    ACORN_AGENT_TRACE_DIR: tracesDir,
    ACORN_AGENT_DATA_DIR: dataDir,
  },
  AGENT_DIR,
);
const health = await agentHealth(AGENT_URL);
/** Whether the agent holds every run before Submit (its own .env setting); a "sent" then means the guard was passed. */
const holdsSubmit = health.stopBeforeSubmit === true;
if (!health.hasKey) {
  agent.kill();
  console.error(
    "REFUSING TO RUN: the agent has no OpenRouter key (OPENROUTER_API_KEY in acorn-agent/.env).",
  );
  process.exit(2);
}
console.log(
  `Agent ready (model ${health.model}, applicant from ${health.source}). ${
    holdsSubmit
      ? "Stop before submit is ON: no application will be sent."
      : "Stop before submit is OFF (ACORN_AGENT_STOP_BEFORE_SUBMIT in acorn-agent/.env): APPLICATIONS WILL BE SENT."
  } Opening Chrome…`,
);

const profileDir = args.profile ? resolve(args.profile) : undefined;
if (profileDir) await mkdir(profileDir, { recursive: true });
const browser = await launchChrome(extensionDir, false, profileDir);
const attempts: AttemptResult[] = [];
let control: Page | null = null;

/** The extension's own page, reopened when Chrome closed or navigated the one in use. */
async function controlPage(): Promise<Page> {
  if (control && !control.isClosed() && !control.mainFrame().detached) return control;
  control = (await openControlPage(browser)).control;
  // Every tab's progress, as the sidebar gets it, kept by tab so a job's last report can be read.
  await control.evaluate((type) => {
    const byTab: Record<string, unknown[]> = {};
    (window as unknown as { __liveProgress: Record<string, unknown[]> }).__liveProgress = byTab;
    chrome.runtime.onMessage.addListener(
      (message: { type: string; tabId: number; progress: unknown }) => {
        if (message.type !== type) return;
        (byTab[String(message.tabId)] ??= []).push(message.progress);
      },
    );
  }, MSG.PIPELINE_PROGRESS);
  return control;
}

/** Runs a read or a command on the control page, once more on a fresh page when the page went away. */
async function onControl<T>(work: (page: Page) => Promise<T>): Promise<T> {
  try {
    return await work(await controlPage());
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (!/detached|Target closed|Session closed|destroyed/i.test(text)) throw err;
    control = null;
    return work(await controlPage());
  }
}

try {
  await controlPage();
  if (health.source === "backend") {
    // The agent reads the signed-in person's profile: the extension in this Chrome must be signed in,
    // and only the person types their password. The sign-in lasts across runs with --profile.
    const signedIn = () =>
      onControl((page) =>
        page.evaluate(
          async (key) =>
            Boolean(
              ((await chrome.storage.local.get(key))[key] as { accessToken?: string } | undefined)
                ?.accessToken,
            ),
          STORAGE_KEYS.session,
        ),
      );
    if (!(await signedIn())) {
      console.log(
        `The agent reads the applicant from Acorn (${health.source}): sign in to Acorn in the Chrome window that just opened (the Acorn Sidebar tab). Waiting up to ${SIGN_IN_TIMEOUT_MS / 60_000} minutes…`,
      );
      const waitedFrom = Date.now();
      while (!(await signedIn())) {
        if (Date.now() - waitedFrom > SIGN_IN_TIMEOUT_MS) {
          throw new Error("not signed in to Acorn in time");
        }
        await pause(SIGN_IN_POLL_MS);
      }
      console.log("Signed in.");
    }
  }
  // A job's last progress: what the control page heard for its tab, else what the extension keeps for it.
  const lastProgress = (tabId: number | undefined): Promise<PipelineProgress | undefined> =>
    tabId == null
      ? Promise.resolve(undefined)
      : onControl((page) =>
          page.evaluate(
            async (id, key) => {
              const heard = (
                window as unknown as { __liveProgress?: Record<string, PipelineProgress[]> }
              ).__liveProgress?.[String(id)]?.at(-1);
              if (heard) return heard;
              const stored = (await chrome.storage.session.get(key))[key] as
                { pipelines?: Record<string, PipelineProgress> } | undefined;
              return stored?.pipelines?.[String(id)];
            },
            tabId,
            TAB_PIPELINES_STORAGE_KEY,
          ),
        );
  const queueCommand = (action: string, rest: Record<string, unknown> = {}) =>
    onControl(
      (page) =>
        page.evaluate(
          (type, command) => chrome.runtime.sendMessage({ type, ...command }),
          MSG.AGENT_QUEUE,
          { action, ...rest },
        ) as Promise<{ ok?: boolean; error?: string; added?: number }>,
    );
  const readQueue = () =>
    onControl((page) =>
      page.evaluate(
        async (key) => ((await chrome.storage.local.get(key))[key] ?? null) as QueueState | null,
        AGENT_QUEUE_STORAGE_KEY,
      ),
    );

  const claimedTraces = new Set<string>();
  const byUrl = new Map(links.map((link) => [link.url, link]));
  /** When each job's Run was first seen working, by job id, for the time limit and the trace match. */
  const running = new Map<string, number>();
  /** The tab each job worked in, by job id: a finished job may have let go of its tab. */
  const tabOf = new Map<string, number>();

  for (let round = 1; round <= args.repeat; round += 1) {
    console.log(`\nRound ${round} of ${args.repeat}: queueing ${links.length} link(s)`);
    await queueCommand(QUEUE_ACTION.clearFinished);
    const added = await queueCommand(QUEUE_ACTION.add, {
      text: links.map((l) => l.url).join("\n"),
    });
    if (added.added !== links.length) {
      throw new Error(`the queue took ${added.added ?? 0} of ${links.length} links`);
    }
    const started = await queueCommand(QUEUE_ACTION.start);
    if (!started.ok) throw new Error(`the queue did not start: ${started.error ?? "unknown"}`);

    const recorded = new Set<string>();
    for (;;) {
      await pause(QUEUE_POLL_MS);
      const queue = await readQueue();
      if (!queue) continue;
      const open = queue.items.filter((item) => !TERMINAL.has(item.status));
      for (const item of queue.items) {
        if (recorded.has(item.id)) continue;
        if (item.tabId != null) tabOf.set(item.id, item.tabId);
        if (item.status === QUEUE_ITEM.running && !running.has(item.id)) {
          running.set(item.id, Date.now());
          console.log(`  working: ${item.url}`);
        }
        const timedOut =
          item.status === QUEUE_ITEM.running &&
          Date.now() - (running.get(item.id) ?? Date.now()) > LINK_TIMEOUT_MS;
        if (timedOut) {
          console.log(`  timed out after ${LINK_TIMEOUT_MS / 1000}s, skipping: ${item.url}`);
          await queueCommand(QUEUE_ACTION.skip, { id: item.id });
        }
        const over = TERMINAL.has(item.status) || item.status === QUEUE_ITEM.blocked || timedOut;
        if (!over) continue;
        recorded.add(item.id);
        attempts.push(await record(item, round, timedOut));
        if (item.status === QUEUE_ITEM.blocked) {
          // The queue paused for the person; a measurement goes on to the next job instead.
          await queueCommand(QUEUE_ACTION.skip, { id: item.id });
          await queueCommand(QUEUE_ACTION.start);
        }
      }
      if (open.length === 0 && queue.mode !== QUEUE_MODE.running) break;
    }
  }

  async function record(item: QueueItem, round: number, timedOut: boolean): Promise<AttemptResult> {
    const link = byUrl.get(item.url);
    const progress = await lastProgress(item.tabId ?? tabOf.get(item.id));
    const ended = outcomeOf(progress);
    if (timedOut) {
      ended.outcome = OUTCOME.error;
      ended.message = `timed out after ${LINK_TIMEOUT_MS / 1000}s: ${ended.message}`;
    }
    const startedMs = item.startedAt ?? running.get(item.id) ?? Date.now();
    const endedMs = item.endedAt ?? Date.now();
    // The run's trace folder: the first one begun since the job's Run started that no job has claimed.
    const trace = (await traceFolders(tracesDir)).find(
      (folder) =>
        !claimedTraces.has(folder.dir) && folder.started >= startedMs - TRACE_START_SLACK_MS,
    );
    if (trace) claimedTraces.add(trace.dir);
    const summary = trace ? traceSummary(trace.dir) : null;
    if (ended.outcome === OUTCOME.sent && holdsSubmit) {
      console.error(
        `\n!!! AN APPLICATION WAS SENT though the agent holds every run before Submit: ${item.url} (round ${round}). The guard was passed. !!!\n`,
      );
    }
    const result: AttemptResult = {
      line: link?.line ?? 0,
      url: item.url,
      host: link?.host ?? "",
      system: siteSystem(link?.host ?? ""),
      attempt: round,
      expect: link?.expect,
      outcome: ended.outcome,
      kind: ended.kind,
      stopReason: ended.stopReason,
      message: ended.message,
      matched: link?.expect ? link.expect === ended.outcome : undefined,
      seconds: Math.max(0, (endedMs - startedMs) / 1000),
      modelCalls: summary?.modelCalls ?? progress?.run?.modelCalls ?? 0,
      decisionCalls: summary?.checks ?? progress?.run?.screenChecks ?? 0,
      inputTokens: summary?.inputTokens ?? 0,
      cachedTokens: summary?.cachedTokens ?? 0,
      outputTokens: summary?.outputTokens ?? 0,
      cost: summary?.totalCost ?? progress?.run?.costUsd ?? 0,
      requiredEmpty: requiredEmpty(progress?.run?.map?.controls),
      traceDir: trace ? relative(REPO_ROOT, trace.dir) : undefined,
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(endedMs).toISOString(),
    };
    console.log(
      `  ${result.outcome}${result.kind ? ` (${result.kind})` : ""}${result.matched === false ? ` (expected ${result.expect})` : ""}: ${Math.round(result.seconds)}s, ${result.modelCalls} calls, $${result.cost.toFixed(4)}`,
    );
    return result;
  }
} catch (err) {
  console.error(err);
} finally {
  agent.kill();
  await browser.close().catch(() => undefined);
}

const finishedAt = new Date();
const results: Results = {
  version: 1,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  linksFile: relative(REPO_ROOT, linksFile),
  repeat: args.repeat,
  agent: {
    model: health.model,
    stopBeforeSubmit: health.stopBeforeSubmit === true,
    url: AGENT_URL,
  },
  attempts,
  summary: summarize(attempts),
  systems: bySystem(attempts),
};
await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2));
await writeFile(join(outDir, "report.md"), renderReport(results, baseline));
console.log(`\nWrote ${relative(REPO_ROOT, join(outDir, "report.md"))} and results.json`);
console.log(
  `${attempts.length} attempts: ready ${results.summary.outcomes.ready}, unavailable ${results.summary.outcomes.unavailable}, need_person ${results.summary.outcomes.need_person}, stuck ${results.summary.outcomes.stuck}, step_limit ${results.summary.outcomes.step_limit}, error ${results.summary.outcomes.error}, SENT ${results.summary.outcomes.sent}`,
);
if (results.summary.outcomes.sent > 0 && holdsSubmit) {
  console.error(
    "!!! At least one application was SENT though stop before submit is on. See the report. !!!",
  );
  process.exit(1);
}
if (attempts.length < links.length * args.repeat) {
  console.error(`only ${attempts.length} of ${links.length * args.repeat} attempts were recorded`);
  process.exit(1);
}
