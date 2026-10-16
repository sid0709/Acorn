import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runActions, type ExecutorContext } from "./executor.ts";
import { fakeCdp } from "./fake-cdp.ts";
import { BLOCKED_MESSAGE, createClickGuard, targetScript, watchForeignFrames } from "./guard.ts";

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

describe("watchForeignFrames", () => {
  const navigated = (cdp: ReturnType<typeof fakeCdp>, frame: Record<string, unknown>) =>
    cdp.emit("Page.frameNavigated", { frame });
  const tree = {
    "Page.getFrameTree": { frameTree: { frame: { securityOrigin: "https://jobs.example" } } },
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("closes a frame of another origin that is an online file source, and tells the model", async () => {
    const cdp = fakeCdp({
      ...tree,
      "DOM.getFrameOwner": { backendNodeId: 4 },
      "DOM.resolveNode": { object: { objectId: "obj" } },
    });
    const notes: string[] = [];
    const asked: AgentVetTarget[] = [];
    watchForeignFrames({
      cdp,
      pageUrl: () => "https://jobs.example/apply",
      vet: async (t) => (asked.push(t), { blocked: true, probability: 0.9 }),
      onClosed: (n) => notes.push(n),
    });
    await settle();
    navigated(cdp, {
      id: "f1",
      parentId: "top",
      url: "https://files.example/chooser",
      securityOrigin: "https://files.example",
    });
    await settle();
    assert.equal(asked[0].kind, "frame");
    assert.equal(asked[0].url, "https://files.example/chooser");
    assert.equal(cdp.of("Runtime.callFunctionOn").length, 1);
    assert.match(notes[0], /files\.example/);
  });

  it("leaves a frame alone that the server clears, one of the page's own origin, and a blank one", async () => {
    const cdp = fakeCdp(tree);
    const notes: string[] = [];
    let asked = 0;
    watchForeignFrames({
      cdp,
      pageUrl: () => "",
      vet: async () => (asked++, { blocked: false, probability: 0.01 }),
      onClosed: (n) => notes.push(n),
    });
    await settle();
    navigated(cdp, {
      id: "a",
      parentId: "top",
      url: "https://www.recaptcha.example/anchor",
      securityOrigin: "https://www.recaptcha.example",
    });
    navigated(cdp, {
      id: "b",
      parentId: "top",
      url: "https://jobs.example/embed",
      securityOrigin: "https://jobs.example",
    });
    navigated(cdp, {
      id: "c",
      parentId: "top",
      url: "about:blank",
      securityOrigin: "https://x.example",
    });
    await settle();
    assert.equal(asked, 1);
    assert.equal(cdp.of("Runtime.callFunctionOn").length, 0);
    assert.deepEqual(notes, []);
  });
});
