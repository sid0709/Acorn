// Runs the agent against a real application page with the quick text pass turned on, in a real
// Chrome with the built extension, and the agent server built from this checkout. It reads the
// OpenRouter key and the applicant from acorn-agent/.env and acorn-agent/data, as `bun run
// dev:acorn-agent` does. It stops before the application is sent, and refuses any request that would
// send it, so nothing reaches the employer.
//
//   bun tests/e2e/agent/live-prefill.ts <application url>
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import puppeteer, { TargetType, type Page } from "puppeteer";

import { MSG } from "../../../acorn/extension/src/types";

import { startSimpleSite } from "./simple-site";

// `local` runs the small three-page site that this harness starts itself; it may be submitted.
const LOCAL = ["local", "local-gated", "local-honeypot", "local-dates", "local-choices"].includes(
  process.argv[2] ?? "",
);
const simple = LOCAL ? startSimpleSite() : null;
const LOCAL_URLS: Record<string, string | undefined> = {
  local: simple?.url,
  "local-gated": simple?.gatedUrl,
  "local-honeypot": simple?.honeypotUrl,
  "local-dates": simple?.datesUrl,
  "local-choices": simple?.choicesUrl,
};
const URL_TO_TEST = LOCAL_URLS[process.argv[2] ?? ""] ?? process.argv[2];
if (!URL_TO_TEST)
  throw new Error("usage: bun tests/e2e/agent/live-prefill.ts <application url | local>");
/** Whether the run stops before it would send the application: always for a real site. */
const STOP_BEFORE_SUBMIT = !LOCAL && process.env.LIVE_ALLOW_SUBMIT !== "1";

const AGENT_DIR = join(import.meta.dir, "../../../acorn-agent");
const EXTENSION_SRC = join(import.meta.dir, "../../../acorn/extension");
const RUN_TIMEOUT_MS = Number(process.env.LIVE_TIMEOUT_MS ?? 300_000);
const VIEWPORT = { width: 1280, height: 900 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A request that would send the application is refused, whatever the agent does. */
const SENDS_APPLICATION = /\/(apply|candidates|submit)\/?(\?|$)/i;

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

const AGENT_URL = `http://127.0.0.1:${freePort()}`;
const work = await mkdtemp(join(tmpdir(), "acorn-live-prefill-"));
const traceDir = join(work, "traces");
const extensionDir = join(work, "extension");

console.log("building the extension (pass on) and the agent…");
const extensionBuild = Bun.spawnSync(
  ["bunx", "vite", "build", "--outDir", extensionDir, "--emptyOutDir"],
  {
    cwd: EXTENSION_SRC,
    env: {
      ...process.env,
      VITE_ACORN_AGENT_URL: AGENT_URL,
      VITE_ACORN_AGENT_PREFILL: "true",
    },
    stderr: "pipe",
    stdout: "pipe",
  },
);
if (extensionBuild.exitCode !== 0) throw new Error(extensionBuild.stderr.toString());
const binary = join(work, "agent");
const build = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/agent"], {
  cwd: AGENT_DIR,
  stderr: "pipe",
});
if (build.exitCode !== 0) throw new Error(build.stderr.toString());

const agent = Bun.spawn([binary], {
  // Run from acorn-agent so it reads its own .env and data/, as the dev server does.
  cwd: AGENT_DIR,
  env: { ...process.env, HTTP_ADDR: new URL(AGENT_URL).host, ACORN_AGENT_TRACE_DIR: traceDir },
  stdout: "pipe",
  stderr: "pipe",
});
for (let i = 0; ; i += 1) {
  if (agent.exitCode !== null) throw new Error("the agent server stopped at start");
  try {
    if ((await fetch(`${AGENT_URL}/agent/v1/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error("the agent server did not start");
  await pause(100);
}
console.log("agent server up at", AGENT_URL);

const browser = await puppeteer.launch({
  headless: false,
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`,
  ],
  defaultViewport: null,
});

const blocked: string[] = [];
const seenPosts: string[] = [];

async function end(code: number): Promise<never> {
  await browser.close().catch(() => undefined);
  agent.kill();
  console.log("work folder:", work);
  process.exit(code);
}

type Progress = {
  phase: string;
  message: string;
  run?: {
    step?: number;
    modelCalls?: number;
    costUsd?: number;
    report?: { outcome: string; failure?: unknown };
  };
};

try {
  const worker = await browser.waitForTarget(
    (t) => t.type() === TargetType.SERVICE_WORKER && t.url().startsWith("chrome-extension://"),
  );
  const extensionId = new URL(worker.url()).host;
  // The run's own log events, from the service worker's console: what the DOM-first loop decided and did.
  const workerHandle = await worker.worker();
  workerHandle?.on("console", (message) => {
    const text = message.text();
    if (!text.includes("[acorn:run]") || !/agent-(dom|click|prefill)/.test(text)) return;
    void Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => "?"))).then((parts) =>
      console.log(
        `EVT ${parts
          .slice(1)
          .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
          .join(" ")
          .slice(0, 320)}`,
      ),
    );
  });
  const control: Page = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/sidebar.html`);

  // Optional: sign the test extension in to Acorn, for the parts of a run that need the person's Acorn
  // session (reading the verification email in their Gmail). The email and password come from the
  // environment and are never written anywhere.
  if (process.env.LIVE_ACORN_EMAIL && process.env.LIVE_ACORN_PASSWORD) {
    type SignIn = { ok?: boolean; error?: string };
    const signedIn = await control.evaluate(
      async (email, password): Promise<SignIn> => {
        const reply: unknown = await chrome.runtime.sendMessage({
          type: "acorn:auth-signin",
          email,
          password,
        });
        return reply as SignIn;
      },
      process.env.LIVE_ACORN_EMAIL,
      process.env.LIVE_ACORN_PASSWORD,
    );
    console.log(signedIn?.ok ? "signed in to Acorn" : `Acorn sign-in failed: ${signedIn?.error}`);
  }

  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      request.method() !== "OPTIONS" &&
      url.protocol.startsWith("http")
    ) {
      seenPosts.push(`${request.method()} ${url.host}${url.pathname}`);
      if (!LOCAL && SENDS_APPLICATION.test(url.pathname)) {
        blocked.push(`${request.method()} ${url.host}${url.pathname}`);
        void request.abort("blockedbyclient");
        return;
      }
    }
    void request.continue();
  });
  await page.goto(URL_TO_TEST, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.bringToFront();
  await pause(3_000);
  const tabId = await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${new globalThis.URL(url).origin}/*` });
    return tab?.id ?? null;
  }, URL_TO_TEST);
  if (tabId == null) throw new Error("the page's tab was not found");

  await control.evaluate(
    (id, type, stop) => {
      const seen: unknown[] = [];
      (window as unknown as { __progress: unknown[] }).__progress = seen;
      chrome.runtime.onMessage.addListener(
        (message: { type: string; tabId: number; progress: unknown }) => {
          if (message.type === "acorn:pipeline-progress" && message.tabId === id)
            seen.push(message.progress);
        },
      );
      void chrome.runtime.sendMessage({ type, tabId: id, stopBeforeSubmit: stop });
    },
    tabId,
    MSG.START_RUN,
    STOP_BEFORE_SUBMIT,
  );
  console.log("run started on tab", tabId);

  const started = Date.now();
  let shown = 0;
  for (;;) {
    const seen = await control.evaluate(
      () => (window as unknown as { __progress: Progress[] }).__progress,
    );
    for (; shown < seen.length; shown += 1) {
      const p = seen[shown];
      console.log(
        `[${Math.round((Date.now() - started) / 1000)}s] ${p.phase} step ${p.run?.step ?? "-"} calls ${p.run?.modelCalls ?? "-"} $${(p.run?.costUsd ?? 0).toFixed(4)} — ${p.message}`,
      );
    }
    const last = seen.at(-1);
    if (last && ["done", "error", "idle"].includes(last.phase) && last.run?.report) {
      console.log("RUN ENDED:", JSON.stringify(last.run.report));
      break;
    }
    if (Date.now() - started > RUN_TIMEOUT_MS) {
      console.log("TIMEOUT: the run had not ended; last:", JSON.stringify(seen.at(-1)));
      break;
    }
    await pause(1_000);
  }

  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>("input, textarea, select"))
      .filter((el) => el.type !== "hidden" && el.type !== "password" && el.offsetParent !== null)
      .map((el) => {
        const label =
          el.getAttribute("aria-label") ||
          el.labels?.[0]?.textContent?.trim() ||
          el.name ||
          el.id ||
          el.type;
        const value =
          el instanceof HTMLSelectElement
            ? (el.selectedOptions[0]?.text ?? "")
            : el.type === "checkbox" || el.type === "radio"
              ? el.checked
                ? "[checked]"
                : ""
              : el.value;
        return `${(label ?? "").replace(/\s+/g, " ").slice(0, 60)} = ${String(value).slice(0, 60)}`;
      })
      .filter((line) => !line.endsWith("= "))
      .slice(0, 80),
  );
  console.log("\nFIELDS WITH A VALUE ON THE PAGE:\n" + fields.join("\n"));
  console.log("\nNON-GET REQUESTS:", [...new Set(seenPosts)].join(" | ") || "none");
  console.log("REFUSED (would send the application):", blocked.join(" | ") || "none");

  const runs = await readdir(traceDir).catch(() => []);
  for (const run of runs) {
    const timeline = await readFile(join(traceDir, run, "timeline.txt"), "utf8").catch(() => "");
    console.log(`\nTIMELINE ${run}\n${timeline}`);
  }
  await end(0);
} catch (err) {
  console.error("live test failed:", err);
  await end(1);
}
