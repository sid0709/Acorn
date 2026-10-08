// Drives the real Acorn extension, headless, through the local multi-step
// application site with Stop before Submit on, and screenshots every step it
// reaches. Passes when the run stops on the Review step, ready to submit, without
// ever sending the application.
//
//   bun run build:acorn && bun tests/e2e/mock-apply/setup.ts && bun tests/e2e/mock-apply/run.ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import puppeteer, { TargetType, type Page } from "puppeteer";

import { STORAGE_KEYS } from "../../../acorn/extension/src/auth/storage-keys";
import {
  TAB_PIPELINES_STORAGE_KEY,
  type TabPipelineMap,
} from "../../../acorn/extension/src/tab-pipeline-session";
import { MSG } from "../../../acorn/extension/src/types";
import { RUN_OUTCOME, type RunProgress } from "../../../acorn/packages/shared/run-types";

import {
  API_URL,
  EXTENSION_DIR,
  OUT_DIR,
  POLL_MS,
  RUN_TIMEOUT_MS,
  readAccount,
  signIn,
} from "./config";
import { mockPort, startMockSite } from "./server";

import type { PipelineProgress } from "../../../acorn/packages/shared/pipeline-types";

/** The step the run must reach, and the one it must never reach. */
const LAST_STEP = "review";
const SENT_STEP = "submitted";
/** How long a session the test hands the extension lasts. */
const SESSION_TTL_MS = 24 * 60 * 60_000;
const VIEWPORT = { width: 1280, height: 900 };

const account = await readAccount();
if (!account) throw new Error("No test account: run `bun tests/e2e/mock-apply/setup.ts` first");
const token = await signIn(account);

const site = startMockSite();
const siteUrl = `http://127.0.0.1:${mockPort()}`;
await mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  defaultViewport: VIEWPORT,
});

/** The run's progress for the tab, as the extension stores it for the sidebar. */
async function readProgress(control: Page, tabId: number): Promise<PipelineProgress | null> {
  return control.evaluate(
    async (key, id): Promise<PipelineProgress | null> => {
      const stored: Record<string, TabPipelineMap | undefined> =
        await chrome.storage.session.get(key);
      return stored[key]?.[String(id)] ?? null;
    },
    TAB_PIPELINES_STORAGE_KEY,
    tabId,
  );
}

const shots: string[] = [];
async function shoot(page: Page, name: string) {
  const file = join(OUT_DIR, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
  console.log(`screenshot ${file}`);
}

try {
  const worker = await browser.waitForTarget(
    (t) => t.type() === TargetType.SERVICE_WORKER && t.url().startsWith("chrome-extension://"),
  );
  const extensionId = new URL(worker.url()).host;

  // An extension page to talk to the service worker, as the sidebar does.
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/sidebar.html`);
  await control.evaluate(
    async (keys, api, session) => {
      await chrome.storage.local.set({ [keys.apiUrl]: api, [keys.session]: session });
    },
    STORAGE_KEYS,
    API_URL,
    {
      accessToken: token,
      username: account.email,
      displayName: account.name,
      profileId: "",
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    },
  );

  const job = await browser.newPage();
  await job.goto(`${siteUrl}/job`);
  await job.waitForFunction(() => document.body.dataset.step === "posting");
  const tabId = await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    return tab?.id ?? null;
  }, siteUrl);
  if (tabId == null) throw new Error("the job tab was not found");

  const started: unknown = await control.evaluate(
    (type, id): Promise<unknown> =>
      chrome.runtime.sendMessage({ type, tabId: id, stopBeforeSubmit: true }),
    MSG.START_RUN,
    tabId,
  );
  console.log("Run started:", JSON.stringify(started));

  const seen: string[] = [];
  let report: RunProgress["report"] | undefined;
  let lastMessage = "";
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const step = await job.evaluate(() => document.body.dataset.step ?? "").catch(() => "");
    if (step && step !== "loading" && step !== seen.at(-1)) {
      seen.push(step);
      console.log(`step reached: ${step}`);
      await shoot(job, step);
    }
    const progress = await readProgress(control, tabId);
    if (progress?.message && progress.message !== lastMessage) {
      lastMessage = progress.message;
      console.log(`  run: ${lastMessage}`);
    }
    report = progress?.run?.report;
    if (report) break;
  }
  await shoot(job, "final");

  const sent = seen.includes(SENT_STEP);
  const ready = report?.outcome === RUN_OUTCOME.readyToSubmit;
  console.log("\nSteps reached:", seen.join(" → "));
  console.log(
    "Run outcome:",
    report?.outcome ?? "(none before the time limit)",
    report?.failure ? `— ${report.failure.label}: ${report.failure.detail}` : "",
  );
  console.log(`Screenshots: ${OUT_DIR}`);
  if (sent) throw new Error("FAIL: the application was submitted; the run must stop before Submit");
  if (!ready || seen.at(-1) !== LAST_STEP)
    throw new Error(`FAIL: the run did not stop ready to submit on ${LAST_STEP}`);
  console.log(`PASS: every step filled; stopped on ${LAST_STEP} without submitting`);
} finally {
  await browser.close();
  await site.stop(true);
}
