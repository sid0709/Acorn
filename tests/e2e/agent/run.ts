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

import { type Page } from "puppeteer";

import { jpegSize } from "../../../acorn/extension/src/agent/capture";
import { QUEUE_ACTION } from "../../../acorn/extension/src/agent-queue/actions";
import { AGENT_QUEUE_STORAGE_KEY } from "../../../acorn/extension/src/agent-queue/store";
import { MSG } from "../../../acorn/extension/src/types";

import {
  answer,
  checked,
  click,
  decisionRequests,
  onSurvey,
  requests,
  startFakeDecisions,
  startFakeModel,
  commit,
  typeInto,
  upload,
  type Point,
  type Points,
  type Survey,
  type Script,
} from "./fake-model";
import {
  agentHealth,
  buildAgent,
  buildExtension,
  freePort,
  launchChrome,
  openControlPage,
  pause,
  startAgent,
  type AgentProcess,
} from "./harness";
import { startAgentSite, startFrameSite } from "./site";

// The test brings its own agent server and its own build of the extension that talks to it,
// so it never touches a server you are running or the extension you have loaded.
const AGENT_URL = `http://127.0.0.1:${freePort()}`;
const RUN_TIMEOUT_MS = 90_000;
/** How long the queue gets to work through its jobs in the Agent Mode test. */
const QUEUE_TIMEOUT_MS = 120_000;

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
const extensionDir = await buildExtension(AGENT_URL);
await mkdir(join(dataDir, "resumes", "Backend"), { recursive: true });
await writeFile(
  join(dataDir, "profile.json"),
  JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com" }),
);
const RESUME_TEXT = "%PDF-1.4 a résumé for the test";
const RESUME_BYTES = Buffer.byteLength(RESUME_TEXT);
await writeFile(join(dataDir, "resumes", "Backend", "Ada-Lovelace.pdf"), RESUME_TEXT);

// ── The servers ──────────────────────────────────────────────────────────────────────
const frameSite = startFrameSite();
const frameOrigin = `http://localhost:${frameSite.port}`;
const site = startAgentSite(frameOrigin);
const siteUrl = `http://127.0.0.1:${site.port}/`;
let points: Points | null = null;
let script: Script = () => answer({ status: "stuck", message: "no script" });
const model = startFakeModel(
  () => points as Points,
  (step, at, survey) => script(step, at, survey),
);

let verdict = { matches: 0.98, blocked: 0.01, loading: 0.01 };
const decisions = startFakeDecisions(() => verdict);
/**
 * The screen checker's requests about a plan's run (a state of parts and a screenshot, asking whether the
 * screen matches); Jev's questions about controls and pages, and the done gate's question, are not them.
 */
const screenRequests = () =>
  decisionRequests.filter((r) => Array.isArray(r.state) && "matches" in r.questions);

const binary = join(dataDir, "agent");
buildAgent(binary);
/** The environment the agent is started with; a test may restart it with a switch added. */
const agentEnv = {
  OPENROUTER_API_KEY: "e2e-not-a-real-key",
  OPENROUTER_BASE_URL: `http://127.0.0.1:${model.port}`,
  ACORN_AGENT_DECISIONS_URL: `http://127.0.0.1:${decisions.port}/`,
  DEFAULT_FALLBACK_RESUME: "Backend",
  ACORN_AGENT_DATA_DIR: dataDir,
  ACORN_AGENT_TRACE_DIR: traceDir,
  ACORN_AGENT_REASONING: "none",
};
let agent: AgentProcess = await startAgent(binary, AGENT_URL, agentEnv, dataDir);

const browser = await launchChrome(extensionDir, true);

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
        agentStop?: { reason: string; kind?: string; problem: string; action: string };
      };
    };
  };
};

/** A job of the Agent tab's queue, as it is kept in storage. */
type QueueJob = { url: string; status: string; note?: string; tabId?: number };
type QueueStored = { mode: string; items: QueueJob[] };

let formPage: Page | null = null;
/** Closes the form tab a test opened, so a tab the queue opens is the only one at its address. */
async function closeForm(): Promise<void> {
  await formPage?.close();
  formPage = null;
}
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
    ...((await page.$("#dropbox")) ? { dropbox: await at("#dropbox") } : {}),
    ...((await page.$("#import")) ? { import: await at("#import") } : {}),
    agree: await at("#agree"),
    upload: await at("#upload"),
    submit: await at("#submit"),
    // The review page's Submit sits where the form is now; it is measured as the page will show it.
    send: await page.evaluate(() => {
      const form = document.getElementById("form")!;
      const review = document.getElementById("review")!;
      form.hidden = true;
      review.hidden = false;
      const r = document.getElementById("send")!.getBoundingClientRect();
      form.hidden = false;
      review.hidden = true;
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }),
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
    // The hook runs once the run is under way: a few progress messages in, or as soon as it waits on
    // the person (a run that asks at its first step sends fewer messages before it stops to wait).
    if (hook && (seen.length >= 3 || last?.run?.ask)) {
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
  control = (await openControlPage(browser)).control;

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
      (finalRun?.costUsd ?? 0) >= 0.005 &&
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
    screenRequests().length === 0,
    "a plan with no checks never asks the decision model",
    screenRequests().length,
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
  // The two typed fields before the upload share one check (19.4a); the upload and the last click are
  // checked on their own, so the plan runs in three parts with two checks between them.
  check(
    screenRequests().length === 2,
    "each checked run was checked once",
    screenRequests().length,
  );
  const asked = screenRequests()[0];
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
    lastLookText.includes("ran in 3 parts") && /- s1a9 done/.test(lastLookText),
    "the model's last look says how its plan went",
    lastLookText,
  );

  // 1c. A checker that says the screen is not what was expected hands the run to the model.
  verdict = { matches: 0.05, blocked: 0.01, loading: 0.01 };
  const checksBefore = screenRequests().length;
  const callsBefore = requests.length;
  const refused = await newForm();
  const refusedRun = await run(refused.tabId);
  check(
    requests.length - callsBefore === 2 && screenRequests().length - checksBefore === 1,
    "a screen that is not as expected goes back to the model after one check",
    { model: requests.length - callsBefore, checks: screenRequests().length - checksBefore },
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

  // 1h. The job description sits in a frame of another origin, a same-origin frame, or an open or a
  // closed shadow root: the agent finds it, nobody is asked, and the model is told it.
  const lookText = (index: number) => {
    const content = requests[index]?.messages.at(-1)?.content;
    return Array.isArray(content)
      ? (content.find((p) => p.type === "text")?.text ?? "")
      : String(content ?? "");
  };
  script = (step, at) =>
    step === 1
      ? answer({ status: "working", message: "Attaching my résumé", actions: [upload(at.upload)] })
      : answer({ status: "done", message: "The application was received" });
  for (const where of ["iframe-x", "iframe-s", "shadow-open", "shadow-closed"]) {
    const before = requests.length;
    const hidden = await newForm(`?jd=${where}`);
    const hiddenRun = await run(hidden.tabId);
    check(
      !hiddenRun.some((p) => p.run?.ask) &&
        (await pageState(hidden.page)).file === "Ada-Lovelace.pdf" &&
        lookText(before).includes("We are hiring a Data Engineer"),
      `the job description is found in ${where.replace("-", " ")} and nobody is asked`,
      { ask: hiddenRun.some((p) => p.run?.ask), look: lookText(before).slice(0, 400) },
    );
  }

  // 1i. A control that brings a file from an online service is never clicked.
  script = (step, at) =>
    step === 1
      ? answer({
          status: "working",
          message: "Choosing my résumé from Dropbox",
          actions: [{ ...click(at.dropbox as Point) }],
        })
      : answer({ status: "done", message: "ok" });
  const beforeCloud = requests.length;
  const cloud = await newForm("?cloud=dropbox");
  await run(cloud.tabId);
  check(
    !(await cloud.page.evaluate(
      () => (window as unknown as { __dropboxClicked?: boolean }).__dropboxClicked,
    )) && lookText(beforeCloud + 1).includes("blocked: that control uses an online file source"),
    "a click on an online file source is refused before it happens, and the model is told why",
    lookText(beforeCloud + 1).slice(0, 500),
  );

  // 1j. A control the guard cannot tell: it opens a window for an online file source, which is closed.
  const beforePopup = requests.length;
  script = (step, at) =>
    step === 1
      ? answer({ status: "working", message: "Importing", actions: [click(at.import as Point)] })
      : answer({ status: "done", message: "ok" });
  const popup = await newForm("?cloud=popup");
  await run(popup.tabId);
  await pause(500);
  const chooserOpen = (await browser.pages()).some((p) => p.url().includes("/chooser"));
  check(
    !chooserOpen && lookText(beforePopup + 1).includes("closed it"),
    "a window that opens for an online file source is closed, and the model is told",
    { chooserOpen, look: lookText(beforePopup + 1).slice(0, 500) },
  );

  // 1k. The same, drawn inside the page as a frame of another origin.
  const beforeFrame = requests.length;
  const framed = await newForm("?cloud=frame");
  await run(framed.tabId);
  check(
    (await framed.page.$("#chooser")) === null && lookText(beforeFrame + 1).includes("closed it"),
    "a frame that opens for an online file source is removed, and the model is told",
    lookText(beforeFrame + 1).slice(0, 500),
  );

  // 1l. A hidden frame from another site (a proxy the page loads for itself) is left alone.
  const beforeHidden = requests.length;
  const framesAsked = () =>
    decisionRequests.filter((r) => typeof r.state === "string" && r.state.includes("A new frame"))
      .length;
  const askedBefore = framesAsked();
  const proxied = await newForm("?cloud=hidden-frame");
  await run(proxied.tabId);
  check(
    (await proxied.page.$("#proxy")) !== null &&
      framesAsked() === askedBefore &&
      !lookText(beforeHidden).includes("closed it") &&
      !lookText(beforeHidden + 1).includes("closed it"),
    "a hidden frame from another site is not judged, not removed, and the model is not told of one",
    { asked: framesAsked() - askedBefore },
  );

  // 1m. The model names a résumé: it is ignored, and the job description chooses (here: the first stack).
  script = (step, at) =>
    step === 1
      ? answer({
          status: "working",
          message: "Attaching the Data résumé",
          actions: [{ ...upload(at.upload), resume: "Data" }],
        })
      : answer({ status: "done", message: "ok" });
  const beforeNamed = requests.length;
  const named = await newForm("?jd=1");
  await run(named.tabId);
  check(
    (await pageState(named.page)).file === "Ada-Lovelace.pdf" &&
      lookText(beforeNamed + 1).includes('You named the résumé "Data"'),
    "a résumé the model names is ignored, the job description chooses it, and the model is told",
    { file: (await pageState(named.page)).file, look: lookText(beforeNamed + 1).slice(0, 400) },
  );

  // 1n. A tall form, each field on a screen of its own: the extension surveys the whole page on the
  // first look, the model plans the whole form from it in one answer, and the extension scrolls to
  // each screen before acting. Two model calls for the whole form: the plan, and the last look.
  const wholeForm = (at: Points, survey: Survey, count = 9) => {
    const on = (p: Point) => onSurvey(survey, p);
    const actions = [
      { ...click(at.name), ...on(at.name) },
      typeInto("Ada Lovelace"),
      { ...click(at.email), ...on(at.email) },
      checked(typeInto("ada@example.com"), "the name and email fields are filled in"),
      { ...click(at.auth), ...on(at.auth) },
      checked(typeInto("Yes"), "the work authorization list shows Yes"),
      { ...click(at.agree), ...on(at.agree) },
      checked({ ...upload(at.upload), ...on(at.upload) }, "the résumé file name is shown"),
      { ...click(at.submit), ...on(at.submit) },
    ];
    return answer({
      status: "working",
      message: "Filling the whole form",
      actions: actions.slice(0, count),
    });
  };
  script = (step, at, survey) => {
    if (step !== 1) return answer({ status: "done", message: "The application was received" });
    if (!survey) throw new Error("the first look of a tall page should be a survey");
    return wholeForm(at, survey);
  };
  const beforeTall = requests.length;
  const tall = await newForm("?jd=1&tall=1");
  const tallRun = await run(tall.tabId);
  const tallForm = await received(tall.page);
  const firstTall = requests[beforeTall]?.messages.at(-1)?.content;
  const surveyImages = Array.isArray(firstTall)
    ? firstTall.filter((p) => p.type === "image_url").length
    : 0;
  check(
    JSON.stringify(tallForm) ===
      JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.com",
        auth: "yes",
        file: "Ada-Lovelace.pdf",
        size: RESUME_BYTES,
      }) && tallRun.at(-1)?.run?.report?.outcome === "completed",
    "a tall form is planned from a survey and filled in across its screens",
    tallForm,
  );
  check(
    surveyImages >= 4 && lookText(beforeTall).includes("survey of the whole page"),
    "the first look of a tall page is a survey of its screens",
    { images: surveyImages },
  );
  check(
    requests.length - beforeTall === 2,
    "the whole tall form took two model calls: the plan and the last look",
    requests.length - beforeTall,
  );

  // 1o. The page grows after the first answer: the points below it no longer mean what the survey
  // saw, so the next action is refused, and the model is told and looks again.
  script = (step, at, survey) =>
    step === 1 ? wholeForm(at, survey as Survey, 4) : answer({ status: "done", message: "ok" });
  const beforeGrow = requests.length;
  const growing = await newForm("?jd=1&tall=1&grow=1");
  await run(growing.tabId);
  check(
    lookText(beforeGrow + 1).includes("changed shape since the survey") &&
      (await pageState(growing.page)).email === "",
    "a page that changed shape since the survey is not acted on, and the model is told",
    lookText(beforeGrow + 1).slice(0, 500),
  );

  // 1p. A run that ends for the person first scrolls what they must act on into view.
  script = (_step, at) =>
    answer({
      status: "need_person",
      message: "A code was sent",
      stop: { reason: "verification", problem: "A code was sent", action: "Enter it" },
      actions: [{ ...click(at.name), kind: "scroll", x: 300, y: 300, dy: 700 }],
    });
  const ending = await newForm("?tall=1");
  await run(ending.tabId);
  const scrolled = await ending.page.evaluate(() => window.scrollY);
  check(scrolled > 200, "a run that ends for the person scrolls before it ends", scrolled);

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

  // 4. Stop before Submit, from the server's own switch: the agent is restarted with
  // ACORN_AGENT_STOP_BEFORE_SUBMIT=true, as the live runner starts it. The form's button goes on to a
  // review page (a "next" click, made as usual); the review page's Submit is the "send", which is never
  // clicked though the model plans it, and the run ends ready to submit with nothing sent.
  agent.kill();
  await agent.exited;
  agent = await startAgent(
    binary,
    AGENT_URL,
    { ...agentEnv, ACORN_AGENT_STOP_BEFORE_SUBMIT: "true" },
    dataDir,
  );
  check(
    (await agentHealth(AGENT_URL)).stopBeforeSubmit === true,
    "the health route says every run stops before the application is sent",
  );
  const fillThenSend: Script = (step, at) => {
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
            click(at.auth),
            typeInto("Yes"),
            click(at.agree),
            upload(at.upload),
          ],
        });
      case 2:
        return answer({
          status: "working",
          message: "Saving and going on to the review page",
          actions: [commit(at.submit, "next")],
        });
      case 3:
        return answer({
          status: "working",
          message: "Sending the application",
          actions: [commit(at.send as Point, "send")],
        });
      default:
        return answer({ status: "done", message: "The application was received" });
    }
  };
  script = fillThenSend;
  const beforeReady = requests.length;
  const reviewing = await newForm("?review=1&jd=1");
  const readyRun = await run(reviewing.tabId);
  const readyEnd = readyRun.at(-1);
  check(
    readyEnd?.run?.report?.outcome === "ready_to_submit",
    "with stop before submit on, the run ends ready to submit",
    readyEnd,
  );
  const reviewShown = await reviewing.page.evaluate(
    () => (window as unknown as { __reviewing?: boolean }).__reviewing === true,
  );
  check(
    reviewShown && (await received(reviewing.page)) === null,
    "the Next click was made (the review page is shown) and Submit was never pressed: nothing was sent",
    { reviewShown, received: await received(reviewing.page) },
  );
  check(
    requests.length - beforeReady === 3,
    "the run ended at the planned Submit, with no further model call",
    requests.length - beforeReady,
  );
  const readySessions = (await readdir(traceDir)).sort(
    (a, b) =>
      Bun.file(join(traceDir, b, "timeline.txt")).lastModified -
      Bun.file(join(traceDir, a, "timeline.txt")).lastModified,
  );
  const readyFolder = join(traceDir, readySessions[0]);
  const readyEntries = (await readdir(readyFolder)).filter((f) => /^\d{3}\.json$/.test(f)).sort();
  const lastEntry = JSON.parse(await readFile(join(readyFolder, readyEntries.at(-1)!), "utf8")) as {
    status: string;
    readyToSubmit?: boolean;
    dropped?: string[];
  };
  const timeline = await readFile(join(readyFolder, "timeline.txt"), "utf8");
  check(
    lastEntry.status === "done" &&
      lastEntry.readyToSubmit === true &&
      (lastEntry.dropped ?? []).some((d) => d.includes("stops before sending")) &&
      timeline.includes("done:ready"),
    "the trace tells a ready run from a sent one and says the send was held back",
    { last: lastEntry, timeline: timeline.split("\n").at(-2) },
  );

  // 5. Agent Mode: the queue with a job nobody can apply to first, then a real form. The expired page
  // ends with job_unavailable at the model's first look, the queue does not pause for it, goes on to the
  // form, and that job ends ready to submit; the queue is idle with both finished.
  await closeForm();
  const expiredUrl = `${siteUrl}expired`;
  const formUrl = `${siteUrl}?review=1&jd=1`;
  const beforeQueue = requests.length;
  script = (step, at, survey, look) => {
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
    return fillThenSend(step, at, survey, look);
  };
  const queueReply = (await control.evaluate(
    (type, action, text) => chrome.runtime.sendMessage({ type, action, text }),
    MSG.AGENT_QUEUE,
    QUEUE_ACTION.add,
    `${expiredUrl}\n${formUrl}`,
  )) as { added?: number };
  check(queueReply.added === 2, "both links are queued", queueReply);
  await control.evaluate(
    (type, action) => chrome.runtime.sendMessage({ type, action }),
    MSG.AGENT_QUEUE,
    QUEUE_ACTION.start,
  );
  const readQueue = () =>
    control.evaluate(
      async (key) =>
        ((await chrome.storage.local.get(key))[key] ?? { mode: "idle", items: [] }) as QueueStored,
      AGENT_QUEUE_STORAGE_KEY,
    );
  const queueStarted = Date.now();
  let queue = await readQueue();
  let pausedSeen = false;
  while (
    queue.mode !== "idle" ||
    queue.items.some((item) => !["ready", "done", "unavailable", "skipped"].includes(item.status))
  ) {
    if (queue.mode === "paused") pausedSeen = true;
    if (Date.now() - queueStarted > QUEUE_TIMEOUT_MS) break;
    await pause(250);
    queue = await readQueue();
  }
  const expiredJob = queue.items.find((item) => item.url === expiredUrl);
  const formJob = queue.items.find((item) => item.url === formUrl);
  check(
    expiredJob?.status === "unavailable" && (expiredJob.note ?? "").includes("no longer open"),
    "the expired job ends as unavailable, with the reason in the person's words",
    expiredJob,
  );
  check(
    !pausedSeen && formJob?.status === "ready" && queue.mode === "idle",
    "the queue moves on past the unavailable job without pausing, and the next job ends ready to submit",
    { pausedSeen, formJob, mode: queue.mode },
  );
  check(
    formJob?.tabId != null &&
      (await control.evaluate(
        (id) =>
          chrome.tabs.get(id).then(
            () => true,
            () => false,
          ),
        formJob?.tabId ?? -1,
      )),
    "a job ready to submit keeps its tab open for the person to review and send",
    formJob,
  );
  const expiredLooks = requests.slice(beforeQueue).filter((r) => {
    const last = r.messages.at(-1)?.content;
    const text = Array.isArray(last)
      ? (last.find((p) => p.type === "text")?.text ?? "")
      : String(last);
    return text.includes("/expired");
  });
  check(
    expiredLooks.length === 1,
    "the expired page costs one model call: the stop is not sent back to finish the page",
    expiredLooks.length,
  );
  const formSent = await (async () => {
    for (const page of await browser.pages()) {
      if (page.url() === formUrl) return received(page);
    }
    return "no page";
  })();
  check(formSent === null, "the queued form was not sent either", formSent);

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
  void frameSite.stop();
  void model.stop();
  void decisions.stop();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall checks passed");
