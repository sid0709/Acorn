import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runAgent } from "./runner.ts";

import type { AgentStep } from "@acorn/shared/agent-contract";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";

type Command = { method: string; params?: Record<string, unknown> };

const realFetch = globalThis.fetch;
const realChrome = (globalThis as { chrome?: unknown }).chrome;

let commands: Command[];
let detached: number;
let attached: number;

/** A browser with one tab whose page answers the commands the agent sends. */
function installBrowser(answers: Record<string, unknown> = {}) {
  commands = [];
  detached = 0;
  attached = 0;
  const noListeners = { addListener() {}, removeListener() {} };
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      get: async (id: number) => ({
        id,
        url: "https://jobs.example/apply?token=secret",
        title: "Apply",
      }),
      onCreated: noListeners,
    },
    debugger: {
      attach: async () => void (attached += 1),
      detach: async () => void (detached += 1),
      onEvent: noListeners,
      onDetach: noListeners,
      sendCommand: async (_target: unknown, method: string, params?: Record<string, unknown>) => {
        commands.push({ method, params });
        if (method === "Page.getLayoutMetrics" && typeof answers[method] === "function") {
          return (answers[method] as () => unknown)();
        }
        if (method === "Page.getLayoutMetrics") {
          return {
            cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 600 },
            cssContentSize: { width: 1000, height: 1800 },
          };
        }
        if (method === "Page.captureScreenshot") return { data: "QUJD" };
        if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" };
        const answer = answers[method] as unknown;
        return typeof answer === "function" ? answer(params) : (answer ?? {});
      },
    },
    runtime: { sendMessage: () => {} },
  };
}

type Seen = { method: string; path: string; body: unknown };
let requests: Seen[];

/** An agent server that answers each step with the next scripted one. */
function installServer(steps: (AgentStep | { status: number; body: unknown })[]) {
  requests = [];
  let next = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method: init?.method ?? "GET", path, body });
    if (path === "/agent/v1/sessions" && init?.method === "POST") {
      return Response.json({
        sessionId: "s1",
        resumes: [{ id: "a.pdf", fileName: "a.pdf", size: 3 }],
      });
    }
    if (path.endsWith("/step")) {
      const reply = steps[Math.min(next++, steps.length - 1)];
      if ("body" in reply) return Response.json(reply.body, { status: reply.status });
      return Response.json(reply);
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
}

const usage = { calls: 1, inputTokens: 100, outputTokens: 10, cost: 0.002 };
const working = (
  number: number,
  actions: AgentStep["actions"],
  message = "Working",
): AgentStep => ({
  status: "working",
  message,
  actions,
  number,
  usage,
});
const finished = (status: AgentStep["status"], number: number, message: string): AgentStep => ({
  status,
  message,
  actions: null,
  number,
  usage,
});

async function run(extra: Partial<Parameters<typeof runAgent>[0]> = {}) {
  const progress: PipelineProgress[] = [];
  const report = await runAgent({
    tabId: 7,
    agentUrl: "http://agent",
    signal: new AbortController().signal,
    stopBeforeSubmit: false,
    emit: (_tabs, p) => progress.push(p),
    retryBackoffMs: [1],
    ...extra,
  });
  return { report, progress };
}

const mouse = (type: string) =>
  commands.filter((c) => c.method === "Input.dispatchMouseEvent" && c.params?.type === type);

beforeEach(() => installBrowser());
afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { chrome?: unknown }).chrome = realChrome;
});

describe("runAgent", () => {
  it("looks, sends the screenshot, performs the actions, and looks again until done", async () => {
    installServer([
      working(1, [{ id: "s1a1", kind: "click", x: 500, y: 300 }], "Opening the form"),
      finished("done", 2, "The application was sent"),
    ]);
    const { report, progress } = await run();

    assert.equal(report.outcome, "completed");
    assert.equal(mouse("mousePressed").length, 1);
    assert.deepEqual(
      [mouse("mousePressed")[0].params?.x, mouse("mousePressed")[0].params?.y],
      [500, 300],
    );

    const steps = requests.filter((r) => r.path.endsWith("/step"));
    assert.equal(steps.length, 2);
    const first = steps[0].body as Record<string, unknown>;
    assert.equal(first.screenshot, "data:image/jpeg;base64,QUJD");
    assert.deepEqual(first.viewport, {
      width: 1000,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      pageWidth: 1000,
      pageHeight: 1800,
    });
    // The second look carries what happened to the first step's actions.
    assert.deepEqual((steps[1].body as { results: unknown }).results, [{ id: "s1a1", ok: true }]);

    assert.deepEqual(progress.map((p) => p.phase).slice(-1), ["done"]);
    assert.match(progress.at(-1)?.message ?? "", /^Done · 2 steps/);
    assert.equal(progress.at(-1)?.run?.report?.outcome, "completed");
  });

  it("sends the page's text when it changes, not on every look", async () => {
    let text = "A long job description about Python development.";
    installBrowser({
      "Runtime.evaluate": (params: { expression?: string }) =>
        params.expression?.includes("nodeValue")
          ? { result: { value: { url: "https://jobs.example/apply", text, custom: 0 } } }
          : {},
    });
    installServer([
      working(1, [{ id: "s1a1", kind: "click", x: 5, y: 5 }]),
      working(2, [{ id: "s2a1", kind: "click", x: 5, y: 5 }]),
      finished("done", 3, "ok"),
    ]);
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (
        String(url).endsWith("/step") &&
        requests.filter((r) => r.path.endsWith("/step")).length === 1
      )
        text = "A different page entirely.";
      return original(url, init);
    }) as typeof fetch;
    await run();
    const sent = requests
      .filter((r) => r.path.endsWith("/step"))
      .map((r) => (r.body as { pageText?: string }).pageText);
    assert.equal(sent[0], "A long job description about Python development.");
    assert.equal(sent[1], undefined);
    assert.equal(sent[2], "A different page entirely.");
  });

  it("asks the person the agent's question, waits, and sends the answer in the next look", async () => {
    installServer([
      {
        status: "ask",
        message: "Upload your default résumé?",
        actions: null,
        number: 1,
        usage,
        ask: {
          id: "resume",
          question: "Upload your default résumé?",
          options: [
            { id: "use_fallback", label: "Yes, upload it" },
            { id: "choose_own", label: "I'll choose" },
          ],
        },
      },
      working(2, [{ id: "s2a1", kind: "click", x: 5, y: 5 }]),
      finished("done", 3, "ok"),
    ]);
    const waited: string[] = [];
    const seen: PipelineProgress[] = [];
    const { report } = await run({
      emit: (_tabs, p) => seen.push(p),
      waitForAnswer: async () => {
        // While it waits, the sidebar has been shown the question.
        waited.push(seen.at(-1)?.run?.ask?.question ?? "");
        return "use_fallback";
      },
    });
    assert.equal(report.outcome, "completed");
    assert.deepEqual(waited, ["Upload your default résumé?"]);
    assert.deepEqual(
      seen.find((p) => p.run?.ask)?.run?.ask?.options.map((o) => o.id),
      ["use_fallback", "choose_own"],
    );
    const steps = requests.filter((r) => r.path.endsWith("/step"));
    assert.equal((steps[1].body as { answer?: string }).answer, "use_fallback");
    assert.equal((steps[2].body as { answer?: string }).answer, undefined);
    // Nothing was clicked while the question was open.
    assert.equal(mouse("mousePressed").length, 1);
  });

  it("stops waiting for an answer when the person presses Stop", async () => {
    installServer([
      {
        status: "ask",
        message: "q",
        actions: null,
        number: 1,
        usage,
        ask: { id: "resume", question: "q", options: [{ id: "a", label: "A" }] },
      },
    ]);
    const stop = new AbortController();
    const { report } = await run({
      signal: stop.signal,
      waitForAnswer: (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped")));
          stop.abort();
        }),
    });
    assert.equal(report.outcome, "stopped");
  });

  /** A page of this height, scrolled by whatever scroll commands arrive. */
  function installTallPage(height: number) {
    let scrollY = 0;
    installBrowser({
      "Runtime.evaluate": (params: { expression?: string }) => {
        const to = /scrollTo\(\{ top: (-?[\d.]+)/.exec(params.expression ?? "");
        if (to) scrollY = Math.min(Number(to[1]), height - 600);
        return {};
      },
      "Page.getLayoutMetrics": () => ({
        cssVisualViewport: { pageX: 0, pageY: scrollY, clientWidth: 1000, clientHeight: 600 },
        cssContentSize: { width: 1000, height },
      }),
    });
  }
  const surveyOf = (index: number) =>
    (
      requests.filter((r) => r.path.endsWith("/step"))[index]?.body as {
        survey?: { screenshot: string; scrollY: number }[];
      }
    ).survey;

  it("sends a survey of a tall page on the first look, scrolling through it and back", async () => {
    installTallPage(1800);
    installServer([
      working(1, [{ id: "s1a1", kind: "click", x: 5, y: 5 }]),
      finished("done", 2, "ok"),
    ]);
    await run();
    const first = surveyOf(0);
    assert.ok(first && first.length >= 3, `survey = ${first?.length}`);
    assert.deepEqual(
      first.map((s) => s.scrollY),
      [...first.map((s) => s.scrollY)].sort((a, b) => a - b),
    );
    assert.equal(first[0].scrollY, 0);
    // The last screen reaches the bottom of the page.
    assert.ok(first.at(-1)!.scrollY >= 1200 - 1);
    assert.equal(surveyOf(1), undefined, "the next look of the same page is one screen");
    const scrolls = commands.filter((c) => String(c.params?.expression).includes("scrollTo("));
    assert.match(
      String(scrolls.at(-1)?.params?.expression),
      /top: 0/,
      "the page is put back where it was",
    );
  });

  it("does not survey a page that is about one screen tall", async () => {
    installTallPage(650);
    installServer([finished("done", 1, "ok")]);
    await run();
    assert.equal(surveyOf(0), undefined);
  });

  it("surveys again when the server asks for it", async () => {
    installTallPage(1800);
    installServer([
      { ...working(1, []), survey: true },
      working(2, [{ id: "s2a1", kind: "click", x: 5, y: 5 }]),
      finished("done", 3, "ok"),
    ]);
    await run();
    assert.ok(surveyOf(0));
    assert.ok(surveyOf(1), "asked for a survey, the next look is one");
    assert.equal(surveyOf(2), undefined);
  });

  it("surveys again when the page changes address", async () => {
    installTallPage(1800);
    let title = "Apply";
    (globalThis as { chrome?: { tabs: { get: unknown } } }).chrome!.tabs.get = async (
      id: number,
    ) => ({
      id,
      url: "https://jobs.example/apply",
      title,
    });
    installServer([
      working(1, [{ id: "s1a1", kind: "click", x: 5, y: 5 }]),
      finished("done", 2, "ok"),
    ]);
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/step")) title = "Next page";
      return original(url, init);
    }) as typeof fetch;
    await run();
    assert.ok(surveyOf(0));
    assert.ok(surveyOf(1), "a new page gets its own survey");
  });

  it("scrolls what the person must act on into view before it ends the run", async () => {
    installTallPage(650);
    installServer([
      {
        status: "need_person",
        message: "A code was sent",
        actions: [{ id: "s1a1", kind: "scroll", x: 300, y: 300, dx: 0, dy: 400 }],
        number: 1,
        usage,
        stop: { reason: "verification", problem: "p", action: "a" },
      },
    ]);
    const { report } = await run();
    assert.equal(report.outcome, "failed");
    const wheels = commands.filter(
      (c) => c.method === "Input.dispatchMouseEvent" && c.params?.type === "mouseWheel",
    );
    assert.ok(wheels.length >= 1, "the run scrolled before it ended");
  });

  it("hides the overlay for the screenshot and shows it again", async () => {
    installServer([finished("done", 1, "ok")]);
    await run();
    const order = commands
      .filter(
        (c) =>
          c.method === "Page.captureScreenshot" ||
          String(c.params?.expression).includes(".capture("),
      )
      .map((c) =>
        c.method === "Page.captureScreenshot"
          ? "shot"
          : String(c.params?.expression).includes("capture(true)")
            ? "hide"
            : "show",
      );
    // The overlay is hidden around every shot of a look (a survey takes several), then shown again.
    assert.equal(order[0], "hide");
    assert.equal(order.at(-1), "show");
    assert.ok(order.slice(1, -1).length >= 1 && order.slice(1, -1).every((o) => o === "shot"));
  });

  it("starts the session on the page's address and ends it when done", async () => {
    installServer([finished("done", 1, "ok")]);
    await run({ stopBeforeSubmit: true });
    assert.deepEqual(requests[0].body, {
      url: "https://jobs.example/apply?token=secret",
      title: "Apply",
      stopBeforeSubmit: true,
    });
    assert.equal(requests.at(-1)?.method, "DELETE");
    assert.equal(detached, 1);
  });

  it("reports ready to submit when it was asked to stop before sending", async () => {
    installServer([finished("done", 1, "Everything is filled in")]);
    const { report } = await run({ stopBeforeSubmit: true });
    assert.equal(report.outcome, "ready_to_submit");
  });

  it("ends a run the person is needed for, in the agent's words", async () => {
    installServer([finished("need_person", 3, "There is a CAPTCHA on this page")]);
    const { report, progress } = await run();
    assert.equal(report.outcome, "failed");
    assert.equal(report.failure?.reason, "waited_for_person");
    assert.equal(report.failure?.label, "There is a CAPTCHA on this page");
    assert.equal(progress.at(-1)?.phase, "error");
    assert.equal(progress.at(-1)?.run?.canContinue, true);
  });

  it("ends a run the agent cannot carry on", async () => {
    installServer([finished("stuck", 9, "The page did not change for 6 steps in a row.")]);
    const { report } = await run();
    assert.equal(report.failure?.reason, "no_progress");
  });

  it("sends the same step again when the model was briefly busy", async () => {
    installServer([
      { status: 429, body: { error: "slow down", code: "rate_limited" } },
      finished("done", 1, "ok"),
    ]);
    const { report } = await run();
    assert.equal(report.outcome, "completed");
    assert.equal(requests.filter((r) => r.path.endsWith("/step")).length, 2);
  });

  it("does not retry a refused key, and says what to do about it", async () => {
    installServer([{ status: 402, body: { error: "insufficient credits", code: "no_credits" } }]);
    const { report } = await run();
    assert.equal(requests.filter((r) => r.path.endsWith("/step")).length, 1);
    assert.equal(report.outcome, "failed");
    assert.equal(report.failure?.reason, "ai_unavailable");
    assert.equal(report.failure?.code, "openrouter_no_credits");
  });

  it("says the agent is not running when nothing answers", async () => {
    installServer([finished("done", 1, "ok")]);
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const { report } = await run();
    assert.equal(report.failure?.code, "offline");
    assert.match(report.failure?.label ?? "", /Can't reach the Acorn agent/);
    assert.equal(detached, 1);
  });

  it("stops at once when the person presses Stop, and leaves the page", async () => {
    installServer([working(1, [{ id: "s1a1", kind: "wait", ms: 60_000 }])]);
    const stop = new AbortController();
    const running = run({ signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop.abort();
    const { report } = await running;
    assert.equal(report.outcome, "stopped");
    assert.equal(detached, 1);
    assert.equal(requests.at(-1)?.method, "DELETE");
  });

  it("never writes what it typed into the log or the progress", async () => {
    installServer([
      working(1, [{ id: "s1a1", kind: "type", text: "hunter2-secret", secret: true }]),
      finished("done", 2, "ok"),
    ]);
    const { progress } = await run();
    assert.ok(!JSON.stringify(progress).includes("hunter2"));
  });

  it("carries the page's files in the debugger session: picker interception on, overlay installed", async () => {
    installServer([finished("done", 1, "ok")]);
    await run();
    const methods = commands.map((c) => c.method);
    for (const wanted of [
      "Page.enable",
      "Page.setInterceptFileChooserDialog",
      "Runtime.addBinding",
      "Page.addScriptToEvaluateOnNewDocument",
    ]) {
      assert.ok(methods.includes(wanted), wanted);
    }
    assert.ok(methods.includes("Page.removeScriptToEvaluateOnNewDocument"));
  });
});
