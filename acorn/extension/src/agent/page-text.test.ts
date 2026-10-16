import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import { readPageText, type FrameText } from "./page-info.ts";

const realChrome = (globalThis as { chrome?: unknown }).chrome;
afterEach(() => {
  (globalThis as { chrome?: unknown }).chrome = realChrome;
});

type Result = { frameId: number; result: FrameText | null };

/** A browser whose tab has these frames; the first is the top frame. */
function installFrames(frames: FrameText[]) {
  (globalThis as { chrome?: unknown }).chrome = {
    scripting: {
      executeScript: async () =>
        frames.map((result, index): Result => ({ frameId: index === 0 ? 0 : 10 + index, result })),
    },
  };
}

const frame = (url: string, text: string, custom = 0): FrameText => ({ url, text, custom });

describe("readPageText", () => {
  it("reads the top frame and a frame of another origin, each labelled by where it came from", async () => {
    installFrames([
      frame("https://jobs.example/apply", "Apply for this job. First name. Last name."),
      frame(
        "https://boards.other.example/jd",
        "We are hiring a Python engineer to build services.",
      ),
    ]);
    const text = await readPageText(fakeCdp(), 5);
    assert.match(text, /^Apply for this job/);
    assert.match(text, /\[Frame from boards\.other\.example\]\nWe are hiring a Python engineer/);
  });

  it("puts the top frame first even when the browser lists it later", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      scripting: {
        executeScript: async () => [
          { frameId: 7, result: frame("https://b.example/x", "inside the frame text") },
          { frameId: 0, result: frame("https://a.example/", "the top page text") },
        ],
      },
    };
    const text = await readPageText(fakeCdp(), 5);
    assert.ok(text.startsWith("the top page text"));
  });

  it("does not repeat a same-origin frame that is already inside its parent's text", async () => {
    const jd =
      "We are hiring a data engineer to build pipelines in Python and own them end to end.";
    installFrames([
      frame("https://jobs.example/", `Header ${jd} Footer`),
      frame("https://jobs.example/jd", jd),
    ]);
    const text = await readPageText(fakeCdp(), 5);
    assert.equal(text.split("We are hiring a data engineer").length - 1, 1);
  });

  it("reaches a closed shadow root through the debugger when a custom element hides one", async () => {
    installFrames([frame("https://jobs.example/", "Apply now. Visible text.", 1)]);
    const cdp = fakeCdp({
      "DOM.getFlattenedDocument": {
        nodes: [
          { nodeId: 1, nodeType: 1, nodeName: "BODY" },
          { nodeId: 2, parentId: 1, nodeType: 3, nodeName: "#text", nodeValue: "Visible text." },
          { nodeId: 3, parentId: 1, nodeType: 1, nodeName: "JOB-POST" },
          { nodeId: 4, parentId: 3, nodeType: 11, nodeName: "#document-fragment" },
          {
            nodeId: 5,
            parentId: 4,
            nodeType: 3,
            nodeName: "#text",
            nodeValue: "We are hiring in a closed shadow root.",
          },
          { nodeId: 6, parentId: 4, nodeType: 1, nodeName: "STYLE" },
          { nodeId: 7, parentId: 6, nodeType: 3, nodeName: "#text", nodeValue: "p { color: red }" },
        ],
      },
    });
    const text = await readPageText(cdp, 5);
    assert.match(text, /\[Deeper in the page\]\nWe are hiring in a closed shadow root\./);
    assert.equal(
      text.split("Visible text.").length - 1,
      1,
      "what a script already read is not added again",
    );
    assert.doesNotMatch(text, /color: red/);
  });

  it("asks the debugger for more only when something points to hidden content", async () => {
    installFrames([
      frame("https://jobs.example/", "Plain page with a plain description of the job."),
    ]);
    const cdp = fakeCdp({ "Page.getFrameTree": { frameTree: { frame: {} } } });
    await readPageText(cdp, 5);
    assert.equal(cdp.of("DOM.getFlattenedDocument").length, 0);
  });

  it("looks deeper when the tab has more frames than a script could enter", async () => {
    installFrames([frame("https://jobs.example/", "Top page text of some length.")]);
    const cdp = fakeCdp({
      "Page.getFrameTree": {
        frameTree: {
          frame: {},
          childFrames: [{ frame: {} }, { frame: {}, childFrames: [{ frame: {} }] }],
        },
      },
      "DOM.getFlattenedDocument": { nodes: [] },
    });
    await readPageText(cdp, 5);
    assert.equal(cdp.of("DOM.getFlattenedDocument").length, 1);
  });

  it("reads the top frame through the debugger when a script cannot be run in the page", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      scripting: {
        executeScript: async () => {
          throw new Error("Cannot access a chrome:// URL");
        },
      },
    };
    const cdp = fakeCdp({
      "Runtime.evaluate": {
        result: { value: frame("https://x.example/", "Text read by the debugger.") },
      },
    });
    assert.equal(await readPageText(cdp, 5), "Text read by the debugger.");
  });

  it("returns nothing for a page with no text, and never throws", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      scripting: { executeScript: async () => Promise.reject(new Error("no")) },
    };
    const cdp = fakeCdp({ "Runtime.evaluate": () => Promise.reject(new Error("gone")) });
    assert.equal(await readPageText(cdp, 5), "");
  });
});
