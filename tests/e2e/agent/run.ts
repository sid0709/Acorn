// Drives a real browser through an application with the agent: the built extension, the
// real Go agent server, a form with the controls an agent meets, and a stand-in for the
// model (so the run needs no key and gives the same answers every time). It checks that
// the extension looks and acts as a person does (real clicks, typing, keys, a résumé
// handed to a file input, the overlay while it works), that what the server is sent is
// what a model needs, that Stop works, and that a run leaves the page and the tab as it found them.
//
//   bun run build:acorn && bun tests/e2e/agent/run.ts
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import puppeteer, { TargetType, type Page } from "puppeteer";

import { jpegSize } from "../../../acorn/extension/src/agent/capture";
import { MSG } from "../../../acorn/extension/src/types";

import {
  answer,
  checked,
  click,
  decisionRequests,
  requests,
  startFakeDecisions,
  startFakeModel,
  typeInto,
  upload,
  type Points,
  type Script,
} from "./fake-model";
import { startAgentSite } from "./site";

const AGENT_DIR = join(import.meta.dir, "../../../acorn-agent");
const EXTENSION_SRC = join(import.meta.dir, "../../../acorn/extension");

/** A port nothing is listening on, found by asking the system for one. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

// The test brings its own agent server and its own build of the extension that talks to it,
// so it never touches a server you are running or the extension you have loaded.
const AGENT_URL = `http://127.0.0.1:${freePort()}`;
const VIEWPORT = { width: 1280, height: 800 };
const RUN_TIMEOUT_MS = 90_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const failures: string[] = [];
function check(passed: boolean, what: string, detail?: unknown) {
  console.log(
    `${passed ? "ok  " : "FAIL"} ${what}${passed || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`,
  );
  if (!passed) failures.push(what);
}

// ── The applicant ────────────────────────────────────────────────────────────────────
const dataDir = await mkdtemp(join(tmpdir(), "acorn-agent-e2e-data-"));
const traceDir = await mkdtemp(join(tmpdir(), "acorn-agent-e2e-trace-"));
const extensionDir = await mkdtemp(join(tmpdir(), "acorn-agent-e2e-extension-"));
const extensionBuild = Bun.spawnSync(
  ["bunx", "vite", "build", "--outDir", extensionDir, "--emptyOutDir"],
  {
    cwd: EXTENSION_SRC,
    env: { ...process.env, VITE_ACORN_AGENT_URL: AGENT_URL },
    stderr: "pipe",
    stdout: "pipe",
  },
);
if (extensionBuild.exitCode !== 0)
  throw new Error(`extension build failed: ${extensionBuild.stderr.toString()}`);
await mkdir(join(dataDir, "resumes", "Backend"), { recursive: true });
await writeFile(
  join(dataDir, "profile.json"),
  JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com" }),
);
const RESUME_TEXT = "%PDF-1.4 a résumé for the test";
const RESUME_BYTES = Buffer.byteLength(RESUME_TEXT);
await writeFile(join(dataDir, "resumes", "Backend", "Ada-Lovelace.pdf"), RESUME_TEXT);

// ── The servers ──────────────────────────────────────────────────────────────────────
const site = startAgentSite();
const siteUrl = `http://127.0.0.1:${site.port}/`;
let points: Points | null = null;
let script: Script = () => answer({ status: "stuck", message: "no script" });
const model = startFakeModel(
  () => points as Points,
  (step, at) => script(step, at),
);

let verdict = { matches: 0.98, blocked: 0.01, loading: 0.01 };
const decisions = startFakeDecisions(() => verdict);

const binary = join(dataDir, "agent");
const build = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/agent"], {
  cwd: AGENT_DIR,
  stderr: "pipe",
});
if (build.exitCode !== 0) throw new Error(`go build failed: ${build.stderr.toString()}`);
const agent = Bun.spawn([binary], {
  cwd: dataDir,
  env: {
    ...process.env,
    HTTP_ADDR: new URL(AGENT_URL).host,
    OPENROUTER_API_KEY: "e2e-not-a-real-key",
    OPENROUTER_BASE_URL: `http://127.0.0.1:${model.port}`,
    ACORN_AGENT_DECISIONS_URL: `http://127.0.0.1:${decisions.port}/`,
    DEFAULT_FALLBACK_RESUME: "Backend",
    ACORN_AGENT_DATA_DIR: dataDir,
    ACORN_AGENT_TRACE_DIR: traceDir,
    ACORN_AGENT_REASONING: "none",
  },
  stdout: "pipe",
  stderr: "pipe",
});

async function waitForAgent() {
  for (let i = 0; i < 50; i += 1) {
    if (agent.exitCode !== null) throw new Error("the agent server stopped at start");
    try {
      if ((await fetch(`${AGENT_URL}/agent/v1/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await pause(100);
  }
  throw new Error("the agent server did not start");
}

const browser = await puppeteer.launch({
  headless: true,
  // The window itself is the size of the page, as it is for a person: an emulated size
  // would give the page one size and the agent's own screenshot another.
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    // A Retina screen: two device pixels to a CSS pixel, as on the machine the agent runs on.
    // A screenshot taken at the page's own size would then come out twice as large as the
    // viewport it is reported with.
    "--force-device-scale-factor=2",
  ],
  defaultViewport: null,
});

type Progress = {
  phase: string;
  message: string;
  run?: {
    step?: number;
    costUsd?: number;
    modelCalls?: number;
    ask?: { id: string; question: string; options: { id: string; label: string }[] };
    report?: {
      outcome: string;
      failure?: {
        reason: string;
        label: string;
        agentStop?: { reason: string; problem: string; action: string };
      };
    };
  };
};

let formPage: Page | null = null;
async function newForm(query = ""): Promise<{ page: Page; tabId: number }> {
  // One form tab at a time, so the extension's lookup by address finds the right one.
  await formPage?.close();
  const page = await browser.newPage();
  formPage = page;
  await page.goto(siteUrl + query);
  await page.bringToFront();
  const at = async (selector: string) =>
    page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
  points = {
    name: await at("#name"),
    email: await at("#email"),
    auth: await at("#auth"),
    agree: await at("#agree"),
    upload: await at("#upload"),
    submit: await at("#submit"),
  };
  const tabId = await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}*` });
    return tab?.id ?? null;
  }, siteUrl);
  if (tabId == null) throw new Error("the form's tab was not found");
  return { page, tabId };
}

const overlayShown = (page: Page) =>
  page.evaluate(() => Boolean(document.querySelector("[data-acorn-agent-overlay]")));
const KEEP_TRACE = Boolean(process.env.E2E_KEEP_TRACE);
const pageState = (page: Page) =>
  page.evaluate(() => ({
    name: (document.getElementById("name") as HTMLInputElement).value,
    email: (document.getElementById("email") as HTMLInputElement).value,
    auth: (document.getElementById("auth") as HTMLSelectElement).value,
    agree: (document.getElementById("agree") as HTMLInputElement).checked,
    file: (document.getElementById("file") as HTMLInputElement).files?.[0]?.name ?? "",
    problem: document.getElementById("problem")?.textContent ?? "",
  }));
const received = (page: Page) =>
  page.evaluate(() => (window as unknown as { __submitted?: unknown }).__submitted ?? null);

/** Starts Run from the extension, as the sidebar's button does, and waits for it to end. */
async function run(
  tabId: number,
  whileRunning?: () => Promise<void>,
  watch?: Page,
): Promise<Progress[]> {
  await control.evaluate(
    (id, start) => {
      const seen: unknown[] = [];
      (window as unknown as { __progress: unknown[] }).__progress = seen;
      chrome.runtime.onMessage.addListener(
        (message: { type: string; tabId: number; progress: unknown }) => {
          if (message.type === "acorn:pipeline-progress" && message.tabId === id)
            seen.push(message.progress);
        },
      );
      void chrome.runtime.sendMessage({ type: start, tabId: id, stopBeforeSubmit: false });
    },
    tabId,
    MSG.START_RUN,
  );
  const started = Date.now();
  let hook = whileRunning;
  let shown = 0;
  let before = "";
  const watcher =
    watch && process.env.E2E_DEBUG
      ? setInterval(() => {
          void pageState(watch)
            .then((state) => {
              const text = JSON.stringify(state);
              if (text !== before) console.log(`[${Date.now() - started}ms]`, (before = text));
            })
            .catch(() => undefined);
        }, 60)
      : undefined;
  for (;;) {
    const seen = await control.evaluate(
      () => (window as unknown as { __progress: Progress[] }).__progress,
    );
    const last = seen.at(-1);
    if (watch && process.env.E2E_DEBUG && seen.length !== shown) {
      shown = seen.length;
      console.log(
        `[progress ${seen.length}] ${last?.message}`,
        JSON.stringify(await pageState(watch)),
      );
    }
    if (last && ["done", "error", "idle"].includes(last.phase) && last.run?.report) {
      clearInterval(watcher);
      return seen;
    }
    if (hook && seen.length >= 3) {
      const once = hook;
      hook = undefined;
      await once();
    }
    if (Date.now() - started > RUN_TIMEOUT_MS)
      throw new Error(`the run did not end: ${JSON.stringify(seen.at(-1))}`);
    await pause(150);
  }
}

let control!: Page;
try {
  await waitForAgent();
  const worker = await browser.waitForTarget(
    (t) => t.type() === TargetType.SERVICE_WORKER && t.url().startsWith("chrome-extension://"),
  );
  const extensionId = new URL(worker.url()).host;
  control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/sidebar.html`);

  // 1. A whole application, from the first click to the confirmation.
  script = (step, at) => {
    switch (step) {
      case 1:
        return answer({
          status: "working",
          message: "Filling in my name and email",
          actions: [
            click(at.name),
            typeInto("Ada Lovelace"),
            click(at.email),
            typeInto("ada@example.com"),
          ],
        });
      case 2:
        // A native list: click it, then type the start of the answer; the list jumps to it.
        return answer({
          status: "working",
          message: "Answering the work authorization question",
          actions: [click(at.auth), typeInto("Yes")],
        });
      case 3:
        return answer({
          status: "working",
          message: "Agreeing and attaching my résumé",
          actions: [click(at.agree), upload(at.upload)],
        });
      case 4:
        return answer({
          status: "working",
          message: "Sending the application",
          actions: [click(at.submit)],
        });
      default:
        return answer({ status: "done", message: "The application was received" });
    }
  };
  const first = await newForm();
  let overlayDuringRun = false;
  const progress = await run(
    first.tabId,
    async () => {
      overlayDuringRun = await overlayShown(first.page);
    },
    first.page,
  );
  const end = progress.at(-1);
  check(end?.run?.report?.outcome === "completed", "the run completes", end);
  check(overlayDuringRun, "the overlay is on the page while the agent works");
  check(!(await overlayShown(first.page)), "the overlay is gone when the run ends");
  const form = await received(first.page);
  if (!form || KEEP_TRACE) {
    console.log("trace folder:", traceDir);
    console.log("page state:", JSON.stringify(await pageState(first.page)));
    for (const request of requests) {
      const last = request.messages.at(-1)?.content;
      const text = Array.isArray(last)
        ? (last.find((p) => p.type === "text")?.text ?? "")
        : String(last);
      console.log(
        text
          .split("\n")
          .filter((line) => /^(Step|- s\d|Note|Keyboard)/.test(line))
          .join(" | "),
      );
    }
  }
  check(
    JSON.stringify(form) ===
      JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.com",
        auth: "yes",
        file: "Ada-Lovelace.pdf",
        size: RESUME_BYTES,
      }),
    "the form received everything: typed text, the native list, the checkbox, and the résumé file",
    form,
  );
  check(
    progress.some((p) => p.run?.step === 3),
    "the sidebar is told each step",
  );
  const finalRun = progress.at(-1)?.run;
  check(
    progress.some((p) => (p.run?.costUsd ?? 0) > 0 && p.phase === "running") &&
      Math.abs((finalRun?.costUsd ?? 0) - 0.005) < 1e-9 &&
      finalRun?.modelCalls === 5,
    "the sidebar is told what the run has cost while it works and when it ends",
    finalRun,
  );

  // What the server sent the model.
  const firstRequest = requests[0];
  const system = firstRequest.messages[0];
  const systemText = typeof system.content === "string" ? system.content : "";
  check(
    system.role === "system" &&
      systemText.includes("Ada Lovelace") &&
      systemText.includes("Backend (pdf)"),
    "the model is told who the applicant is and which résumés there are",
  );
  const userContent = firstRequest.messages.at(-1)?.content;
  const image = Array.isArray(userContent)
    ? userContent.find((p) => p.type === "image_url")?.image_url?.url
    : undefined;
  check(Boolean(image?.startsWith("data:image/jpeg;base64,")), "the model is sent a screenshot");
  check(
    firstRequest.response_format?.type === "json_schema" &&
      firstRequest.response_format.json_schema?.strict === true,
    "the model must answer in the step schema",
  );
  const second = requests[1].messages.at(-1)?.content;
  const secondText = Array.isArray(second)
    ? (second.find((p) => p.type === "text")?.text ?? "")
    : String(second);
  check(
    /Results of your last actions:\n- s1a1 done/.test(secondText) &&
      secondText.includes("filling it in"),
    "the next look carries the results of the actions and the model's own notes",
    secondText,
  );
  check(requests.length === 5, "one model call per look", requests.length);

  // The recorded run: a screenshot and the answer for every step, nothing typed in secret.
  const sessions = await readdir(traceDir);
  const files = sessions.length === 1 ? await readdir(join(traceDir, sessions[0])) : [];
  check(
    files.filter((f) => /^\d{3}\.jpg$/.test(f)).length === 5 &&
      files.filter((f) => /^\d{3}\.json$/.test(f)).length === 5,
    "every step was recorded with its screenshot and the model's answer",
    files,
  );
  if (sessions[0]) {
    const stepOne = JSON.parse(await readFile(join(traceDir, sessions[0], "001.json"), "utf8")) as {
      actions: { kind: string }[];
      message: string;
    };
    check(
      stepOne.actions.length === 4 && stepOne.message === "Filling in my name and email",
      "the recorded step shows what was asked and done",
    );
    // The model measures in the image it is shown: its size must be the viewport's.
    const jpg = await readFile(join(traceDir, sessions[0], "001.jpg"));
    const pixels = jpegSize(jpg.toString("base64"));
    const reported = (
      JSON.parse(await readFile(join(traceDir, sessions[0], "001.json"), "utf8")) as {
        viewport: { width: number; height: number };
      }
    ).viewport;
    check(
      pixels?.width === reported.width && pixels?.height === reported.height,
      "the screenshot's pixels are the viewport the model is told, even at two device pixels to a CSS pixel",
      { image: pixels, reported },
    );
  }

  check(
    decisionRequests.length === 0,
    "a plan with no checks never asks the decision model",
    decisionRequests.length,
  );

  // 1b. A whole screen planned at once: the decision model checks each run, the model is
  // called for the plan and for the last look only.
  const modelCallsBefore = requests.length;
  script = (step, at) =>
    step === 1
      ? answer({
          status: "working",
          message: "Filling the whole form",
          actions: [
            click(at.name),
            typeInto("Ada Lovelace"),
            click(at.email),
            checked(typeInto("ada@example.com"), "the name and email fields are filled in"),
            click(at.auth),
            checked(typeInto("Yes"), "the work authorization list shows Yes"),
            click(at.agree),
            checked(upload(at.upload), "the résumé file name is shown"),
            click(at.submit),
          ],
        })
      : answer({ status: "done", message: "The application was received" });
  const planned = await newForm();
  const plannedRun = await run(planned.tabId);
  check(
    plannedRun.at(-1)?.run?.report?.outcome === "completed",
    "a planned run completes",
    plannedRun.at(-1),
  );
  const plannedForm = await received(planned.page);
  check(
    JSON.stringify(plannedForm) ===
      JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.com",
        auth: "yes",
        file: "Ada-Lovelace.pdf",
        size: RESUME_BYTES,
      }),
    "the planned run filled in everything the same as the step-by-step one",
    plannedForm,
  );
  check(
    requests.length - modelCallsBefore === 2,
    "the model was called for the plan and the last look, not for every run",
    requests.length - modelCallsBefore,
  );
  check(
    decisionRequests.length === 3,
    "each checked run was checked once",
    decisionRequests.length,
  );
  const asked = decisionRequests[0];
  check(
    Array.isArray(asked?.state) &&
      asked.state.some((p) => p.image_url?.url.startsWith("data:image/jpeg;base64,")) &&
      asked.questions.matches.instructions.includes("the name and email fields are filled in"),
    "the checker is shown the screenshot and what the model expected",
  );
  const lastLook = requests.at(-1)?.messages.at(-1)?.content;
  const lastLookText = Array.isArray(lastLook)
    ? (lastLook.find((p) => p.type === "text")?.text ?? "")
    : String(lastLook);
  check(
    lastLookText.includes("ran in 4 parts") && /- s1a9 done/.test(lastLookText),
    "the model's last look says how its plan went",
    lastLookText,
  );

  // 1c. A checker that says the screen is not what was expected hands the run to the model.
  verdict = { matches: 0.05, blocked: 0.01, loading: 0.01 };
  const checksBefore = decisionRequests.length;
  const callsBefore = requests.length;
  const refused = await newForm();
  const refusedRun = await run(refused.tabId);
  check(
    requests.length - callsBefore === 2 && decisionRequests.length - checksBefore === 1,
    "a screen that is not as expected goes back to the model after one check",
    { model: requests.length - callsBefore, checks: decisionRequests.length - checksBefore },
  );
  check(
    refusedRun.at(-1)?.run?.report?.outcome === "completed",
    "the run still ends",
    refusedRun.at(-1),
  );
  verdict = { matches: 0.98, blocked: 0.01, loading: 0.01 };

  // 1d. A page only the person can get past: the run ends with a reason the sidebar can show.
  script = () =>
    answer({
      status: "need_person",
      message: "Solve the CAPTCHA",
      stop: {
        reason: "captcha",
        problem: "The page asks you to prove you're not a robot.",
        action: "Tick the box and solve the picture puzzle.",
      },
    });
  const human = await newForm();
  const humanRun = await run(human.tabId);
  const humanFailure = humanRun.at(-1)?.run?.report?.failure;
  check(
    humanFailure?.reason === "waited_for_person" &&
      humanFailure.agentStop?.reason === "captcha" &&
      humanFailure.agentStop.action === "Tick the box and solve the picture puzzle.",
    "a run that needs the person ends with the reason, the problem and what to do",
    humanFailure,
  );

  // 1e. No job description on any page: the agent asks which résumé before it uploads one, every
  // time, and sends the default only when the person says yes. A second résumé folder makes it a choice.
  await mkdir(join(dataDir, "resumes", "Data"), { recursive: true });
  await writeFile(join(dataDir, "resumes", "Data", "Other.pdf"), "%PDF-1.4 another résumé");
  script = (step, at) =>
    step === 1
      ? answer({
          status: "working",
          message: "Attaching my résumé",
          actions: [upload(at.upload)],
        })
      : answer({ status: "done", message: "The application was received" });
  const answerWhenAsked = (tabId: number, option: string) => async () => {
    for (let i = 0; i < 100; i += 1) {
      const asking = await control.evaluate(() =>
        (window as unknown as { __progress: Progress[] }).__progress.some((p) => p.run?.ask),
      );
      if (asking) break;
      await pause(100);
    }
    await control.evaluate(
      (id, type, chosen) => chrome.runtime.sendMessage({ type, tabId: id, answer: chosen }),
      tabId,
      MSG.ANSWER_RUN,
      option,
    );
  };
  const callsBeforeAsk = requests.length;
  const asking = await newForm();
  const askedRun = await run(asking.tabId, answerWhenAsked(asking.tabId, "use_fallback"));
  const question = askedRun.find((p) => p.run?.ask)?.run?.ask;
  check(
    question?.options.map((o) => o.id).join() === "use_fallback,choose_own" &&
      question.question.includes("Backend"),
    "with no job description the sidebar is asked whether to upload the default résumé",
    question,
  );
  check(
    (await pageState(asking.page)).file === "Ada-Lovelace.pdf" &&
      askedRun.at(-1)?.run?.report?.outcome === "completed",
    "a yes uploads the default résumé and the run carries on",
    await pageState(asking.page),
  );
  check(
    requests.length - callsBeforeAsk === 2,
    "the model is not called while the question is open, nor for the upload itself",
    requests.length - callsBeforeAsk,
  );

  // 1f. The person says they will choose: the run ends for them to upload, with the reason.
  const choosing = await newForm();
  const choseRun = await run(choosing.tabId, answerWhenAsked(choosing.tabId, "choose_own"));
  const choseFailure = choseRun.at(-1)?.run?.report?.failure;
  check(
    choseFailure?.agentStop?.reason === "resume_choice" &&
      (await pageState(choosing.page)).file === "",
    "choosing a résumé yourself ends the run with nothing uploaded and says why",
    choseFailure,
  );

  // 1g. A job description on the page: the résumé is chosen from it, and nobody is asked.
  const jdCalls = requests.length;
  const described = await newForm("?jd=1");
  const describedRun = await run(described.tabId);
  check(
    !describedRun.some((p) => p.run?.ask) &&
      (await pageState(described.page)).file === "Ada-Lovelace.pdf" &&
      describedRun.at(-1)?.run?.report?.outcome === "completed",
    "with a job description on the page the résumé is chosen without asking",
    await pageState(described.page),
  );
  const choice = decisionRequests.find(
    (r) => typeof r.state === "string" && "resume" in r.questions,
  );
  check(
    typeof choice?.state === "string" &&
      choice.state.includes("Job description:") &&
      choice.state.includes("We are hiring a Data Engineer"),
    "Jev chooses the résumé from the whole job description",
    choice?.state,
  );
  const firstLook = requests[jdCalls]?.messages.at(-1)?.content;
  const firstText = Array.isArray(firstLook)
    ? (firstLook.find((p) => p.type === "text")?.text ?? "")
    : String(firstLook);
  check(
    firstText.includes("The job description, read from the page text"),
    "the model is told the job description on its first look",
  );

  // 2. Stop works, at once, and leaves the page as it is.
  script = (step, at) =>
    step === 1
      ? answer({
          status: "working",
          message: "Typing my name",
          actions: [click(at.name), typeInto("Ada")],
        })
      : answer({
          status: "working",
          message: "Waiting",
          actions: [{ ...click(at.name), kind: "wait", ms: 30_000 }],
        });
  const second2 = await newForm();
  const stopped = await run(second2.tabId, async () => {
    // Stop once the page has shown the typing, while the agent is in its long wait.
    await second2.page.waitForFunction(
      () => (document.getElementById("name") as HTMLInputElement).value === "Ada",
    );
    await control.evaluate(
      (id, stop) => chrome.runtime.sendMessage({ type: stop, tabId: id }),
      second2.tabId,
      MSG.STOP_RUN,
    );
  });
  const stoppedEnd = stopped.at(-1);
  check(stoppedEnd?.run?.report?.outcome === "stopped", "Stop ends the run", stoppedEnd);
  check(!(await overlayShown(second2.page)), "the overlay is gone after Stop");
  check(
    (await second2.page.$eval("#name", (el) => (el as HTMLInputElement).value)) === "Ada",
    "Stop leaves the page as it was",
  );

  // 3. The agent not running is said plainly.
  agent.kill();
  await agent.exited;
  const third = await newForm();
  const offline = await run(third.tabId);
  const offlineEnd = offline.at(-1);
  check(
    offlineEnd?.run?.report?.failure?.label.includes("Can't reach the Acorn agent") === true,
    "an agent that is not running is reported in plain words",
    offlineEnd,
  );
} catch (err) {
  console.error(err);
  failures.push(`threw: ${String(err)}`);
} finally {
  agent.kill();
  await browser.close();
  void site.stop();
  void model.stop();
  void decisions.stop();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall checks passed");
