import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runActions, type ExecutorContext } from "./executor.ts";
import { fakeCdp } from "./fake-cdp.ts";
import {
  BLOCKED_MESSAGE,
  SIGN_ON_BLOCKED_MESSAGE,
  blockedMessage,
  createClickGuard,
  createFrameSweep,
  targetScript,
  watchFrameEvents,
  windowClosedNote,
} from "./guard.ts";

import type { Overlay } from "./overlay.ts";
import type { AgentVetTarget, AgentVetVerdict } from "@acorn/shared/agent-contract";

type Described = Record<string, unknown>;

/** A page whose control at any point is this one. */
const pageWith = (described: Described | null) =>
  fakeCdp({ "Runtime.evaluate": () => ({ result: { value: described } }) });

const button = (text: string, extra: Described = {}): Described => ({
  tag: "button",
  type: "button",
  role: "",
  text,
  label: "",
  title: "",
  alt: "",
  linkHost: "",
  idClass: "",
  inFileComponent: true,
  formField: false,
  ...extra,
});

function guardFor(
  described: Described | null,
  answer: (t: AgentVetTarget) => AgentVetVerdict | Error,
) {
  const asked: AgentVetTarget[] = [];
  const guard = createClickGuard({
    cdp: () => pageWith(described),
    pageUrl: () => "https://jobs.example/apply",
    vet: async (target) => {
      asked.push(target);
      const result = answer(target);
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return { guard, asked };
}

describe("createClickGuard", () => {
  it("asks the server about what is under the click, with the page it is on, and blocks what it blocks", async () => {
    const { guard, asked } = guardFor(button("Dropbox"), () => ({
      blocked: true,
      probability: 0.96,
      reason: "it is an online file source",
    }));
    const verdict = await guard(10, 10);
    assert.equal(verdict.blocked, true);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].kind, "control");
    assert.equal(asked[0].text, "Dropbox");
    assert.equal(asked[0].pageUrl, "https://jobs.example/apply");
    assert.equal(
      "formField" in asked[0],
      false,
      "what the page reports about itself is not a judgment to send on",
    );
  });

  it("lets a control through that the server clears, and asks about it once", async () => {
    const { guard, asked } = guardFor(button("Attach"), () => ({
      blocked: false,
      probability: 0.01,
    }));
    assert.equal((await guard(1, 1)).blocked, false);
    assert.equal((await guard(2, 2)).blocked, false);
    assert.equal(asked.length, 1);
  });

  it("does not ask about a plain form field", async () => {
    const { guard, asked } = guardFor(
      { tag: "input", type: "text", text: "", inFileComponent: false, formField: true },
      () => ({ blocked: true, probability: 1 }),
    );
    assert.equal((await guard(1, 1)).blocked, false);
    assert.equal(asked.length, 0);
  });

  it("asks about a field inside a file component, since a file component's controls are what matter", async () => {
    const { guard, asked } = guardFor(
      { tag: "input", type: "text", text: "", inFileComponent: true, formField: true },
      () => ({ blocked: false, probability: 0 }),
    );
    await guard(1, 1);
    assert.equal(asked.length, 1);
  });

  it("blocks a control in a file component when the server cannot be asked, and lets another through", async () => {
    const down = () => new Error("unreachable");
    assert.equal((await guardFor(button("Attach"), down).guard(1, 1)).blocked, true);
    assert.equal(
      (await guardFor(button("Next", { inFileComponent: false }), down).guard(1, 1)).blocked,
      false,
    );
  });

  it("lets a click through when the page has nothing there to describe", async () => {
    const { guard, asked } = guardFor(null, () => ({ blocked: true, probability: 1 }));
    assert.equal((await guard(1, 1)).blocked, false);
    assert.equal(asked.length, 0);
  });
});

describe("targetScript", () => {
  it("reads only what the control says of itself, with the point it was given", () => {
    const script = targetScript(12.5, 40);
    assert.match(script, /\)\(12\.5, 40\)$/);
    for (const part of [
      "elementFromPoint",
      "shadowRoot",
      "contentDocument",
      'input[type="file"]',
      "aria-label",
    ]) {
      assert.ok(script.includes(part), part);
    }
  });

  it("names no service: the model decides what a control is", () => {
    assert.doesNotMatch(targetScript(1, 1), /dropbox|drive|onedrive|box\.com|google/i);
  });
});

function context(guard: ExecutorContext["guard"]) {
  const cdp = fakeCdp();
  const ctx: ExecutorContext = {
    cdp,
    overlay: {
      moveTo: async () => {},
      click: async () => {},
      hover: async () => {},
    } as unknown as Overlay,
    scale: () => 1,
    resume: async () => ({ fileName: "r.pdf", contentType: "application/pdf", base64: "QQ==" }),
    sleep: async () => {},
    checkStopped: () => {},
    guard,
  };
  return { ctx, cdp };
}

describe("the executor and the guard", () => {
  it("never sends the click the guard blocks, and says why", async () => {
    const { ctx, cdp } = context(async () => ({ blocked: true, reason: "x" }));
    const results = await runActions(ctx, [
      { id: "a", kind: "click", x: 5, y: 5 },
      { id: "b", kind: "click", x: 9, y: 9 },
    ]);
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error, BLOCKED_MESSAGE);
    assert.equal(results[1].ok, false, "what was planned after a blocked click is skipped");
    assert.equal(cdp.of("Input.dispatchMouseEvent").length, 0);
  });

  it("never sends an upload the guard blocks", async () => {
    const { ctx, cdp } = context(async () => ({ blocked: true }));
    const results = await runActions(ctx, [
      { id: "u", kind: "upload", x: 5, y: 5, resume: "a.pdf", fileName: "a.pdf" },
    ]);
    assert.equal(results[0].ok, false);
    assert.equal(cdp.of("Input.dispatchMouseEvent").length, 0);
  });

  it("clicks when the guard allows it", async () => {
    const { ctx, cdp } = context(async () => ({ blocked: false }));
    const results = await runActions(ctx, [{ id: "a", kind: "click", x: 5, y: 5 }]);
    assert.equal(results[0].ok, true);
    assert.ok(cdp.of("Input.dispatchMouseEvent").length > 0);
  });
});

describe("createFrameSweep", () => {
  /** A page that holds these frames (as the page script reports them), with its own origin. */
  const pageWith = (frames: string[]) =>
    fakeCdp({
      "Runtime.evaluate": (params: { expression?: string }) =>
        params.expression?.includes("found.push")
          ? { result: { value: { origin: "https://jobs.example", frames } } }
          : {},
    });
  const removals = (cdp: ReturnType<typeof fakeCdp>) =>
    cdp.of("Runtime.evaluate").filter((c) => String(c.params?.expression).includes(".remove()"));

  it("removes a frame of another origin that is an online file source, and says so neutrally", async () => {
    const cdp = pageWith(["https://files.example/chooser"]);
    const notes: string[] = [];
    const asked: AgentVetTarget[] = [];
    await createFrameSweep({
      cdp,
      pageUrl: () => "https://jobs.example/apply",
      vet: async (t) => (asked.push(t), { blocked: true, probability: 0.9 }),
      onClosed: (n) => notes.push(n),
    })();
    assert.equal(asked[0].kind, "frame");
    assert.equal(asked[0].url, "https://files.example/chooser");
    assert.equal(removals(cdp).length, 1);
    assert.match(notes[0], /files\.example/);
    assert.doesNotMatch(notes[0], /click/i, "nobody is told they clicked what they did not");
  });

  it("leaves alone a frame the server clears, the page's own origin, a blank one, and a non-web one", async () => {
    const cdp = pageWith([
      "https://www.recaptcha.example/anchor",
      "https://jobs.example/embed",
      "about:blank",
      "javascript:void(0)",
      "",
    ]);
    const asked: string[] = [];
    const sweep = createFrameSweep({
      cdp,
      pageUrl: () => "",
      vet: async (t) => (asked.push(t.url ?? ""), { blocked: false, probability: 0.01 }),
      onClosed: () => assert.fail("nothing is closed"),
    });
    await sweep();
    await sweep();
    assert.deepEqual(
      asked,
      ["https://www.recaptcha.example/anchor"],
      "each address is judged once",
    );
    assert.equal(removals(cdp).length, 0);
  });

  it("leaves a frame alone when the server cannot be asked", async () => {
    const cdp = pageWith(["https://files.example/chooser"]);
    await createFrameSweep({
      cdp,
      pageUrl: () => "",
      vet: async () => Promise.reject(new Error("unreachable")),
      onClosed: () => assert.fail("nothing is closed"),
    })();
    assert.equal(removals(cdp).length, 0);
  });
});

describe("watchFrameEvents", () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("sweeps when a frame inside the page navigates, once for a burst, and not for the top frame", async () => {
    const cdp = fakeCdp();
    let sweeps = 0;
    const stop = watchFrameEvents(cdp, async () => void (sweeps += 1));
    cdp.emit("Page.frameNavigated", { frame: { id: "top", url: "https://jobs.example/" } });
    cdp.emit("Page.frameNavigated", { frame: { id: "a", parentId: "top" } });
    cdp.emit("Page.frameNavigated", { frame: { id: "b", parentId: "top" } });
    await wait(250);
    assert.equal(sweeps, 1);
    stop();
    cdp.emit("Page.frameNavigated", { frame: { id: "c", parentId: "top" } });
    await wait(250);
    assert.equal(sweeps, 1, "after stop nothing is swept");
  });
});

describe("signing in through another service's account", () => {
  it("passes the server's cause on, so the click is told why", async () => {
    const { guard } = guardFor(button("Continue with an account"), () => ({
      blocked: true,
      probability: 0.9,
      cause: "single_sign_on",
    }));
    const verdict = await guard(10, 10);
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.cause, "single_sign_on");
  });

  it("refuses the click with the sign-in message, not the file-source one", async () => {
    const { ctx, cdp } = context(async () => ({ blocked: true, cause: "single_sign_on" }));
    const results = await runActions(ctx, [{ id: "a", kind: "click", x: 5, y: 5 }]);
    assert.equal(results[0].error, SIGN_ON_BLOCKED_MESSAGE);
    assert.notEqual(results[0].error, BLOCKED_MESSAGE);
    assert.equal(cdp.of("Input.dispatchMouseEvent").length, 0);
  });

  it("keeps the file-source message when the cause is not given", () => {
    assert.equal(blockedMessage(), BLOCKED_MESSAGE);
    assert.equal(blockedMessage("online_source"), BLOCKED_MESSAGE);
    assert.match(windowClosedNote(), /online file source/);
    assert.match(windowClosedNote("single_sign_on"), /another service/);
  });

  it("closes a frame that offers it, and says so without naming a service", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": (params: { expression?: string }) =>
        params.expression?.includes("found.push")
          ? {
              result: {
                value: {
                  origin: "https://jobs.example",
                  frames: ["https://login.example/consent"],
                },
              },
            }
          : {},
    });
    const notes: string[] = [];
    await createFrameSweep({
      cdp,
      pageUrl: () => "https://jobs.example/apply",
      vet: async () => ({ blocked: true, probability: 0.9, cause: "single_sign_on" }),
      onClosed: (n) => notes.push(n),
    })();
    assert.match(notes[0], /login\.example/);
    assert.match(notes[0], /another service/);
  });
});
