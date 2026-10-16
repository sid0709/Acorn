import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import { collectPageText, readPageText } from "./page-info.ts";

type FakeNode = {
  nodeType: number;
  nodeValue?: string;
  tagName?: string;
  style?: { display?: string; visibility?: string };
  shadowRoot?: null;
  firstChild: FakeNode | null;
  nextSibling: FakeNode | null;
  ownerDocument?: unknown;
};

/** A tiny DOM: elements with a computed style, and text. */
function el(tag: string, style: FakeNode["style"], ...children: (FakeNode | string)[]): FakeNode {
  const nodes = children.map((child): FakeNode =>
    typeof child === "string"
      ? { nodeType: 3, nodeValue: child, firstChild: null, nextSibling: null }
      : child,
  );
  nodes.forEach((node, i) => (node.nextSibling = nodes[i + 1] ?? null));
  return {
    nodeType: 1,
    tagName: tag,
    style,
    shadowRoot: null,
    firstChild: nodes[0] ?? null,
    nextSibling: null,
  };
}

const globals = globalThis as Record<string, unknown>;
const real = { document: globals.document, location: globals.location, window: globals.window };
afterEach(() => {
  globals.document = real.document;
  globals.location = real.location;
  globals.window = real.window;
});

function install(root: FakeNode) {
  const view = {
    getComputedStyle: (node: FakeNode) => ({
      display: "block",
      visibility: "visible",
      ...node.style,
    }),
  };
  const mark = (node: FakeNode | null): void => {
    for (let n = node; n; n = n.nextSibling) {
      n.ownerDocument = { defaultView: view };
      mark(n.firstChild);
    }
  };
  mark(root);
  globals.document = { documentElement: root };
  globals.location = { href: "https://jobs.example/apply" };
  globals.window = view;
}

describe("collectPageText", () => {
  it("leaves out text the page does not show, so a model is not told what the screen contradicts", () => {
    install(
      el(
        "BODY",
        {},
        el("LABEL", {}, "Resume"),
        el("DIV", { display: "none" }, "We've received your resume. Click here to update it."),
        el("DIV", {}, "Attach resume or Paste resume"),
        el("DIV", { visibility: "hidden" }, el("SPAN", {}, "A closed menu")),
      ),
    );
    const { text } = collectPageText(10_000);
    assert.match(text, /Attach resume or Paste resume/);
    assert.doesNotMatch(text, /received your resume/);
    assert.doesNotMatch(text, /closed menu/);
  });

  it("still reads an element that cannot be styled", () => {
    const odd = el("DIV", {}, "text in another document");
    odd.ownerDocument = {
      defaultView: {
        getComputedStyle: () => {
          throw new Error("no");
        },
      },
    };
    globals.document = { documentElement: odd };
    globals.location = { href: "https://jobs.example/" };
    assert.match(collectPageText(10_000).text, /another document/);
  });
});

describe("the debugger's view of the page", () => {
  const withFlat = (nodes: Record<string, unknown>[]) =>
    fakeCdp({ "DOM.getFlattenedDocument": { nodes } });

  it("adds text from a closed shadow root, and not the hidden text a script read left out", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      scripting: {
        executeScript: async () => [
          { frameId: 0, result: { url: "https://a.example/", text: "Apply here", custom: 1 } },
        ],
      },
    };
    const cdp = withFlat([
      { nodeId: 1, nodeType: 9, nodeName: "#document" },
      { nodeId: 2, parentId: 1, nodeType: 1, nodeName: "DIV" },
      {
        nodeId: 3,
        parentId: 2,
        nodeType: 3,
        nodeName: "#text",
        nodeValue: "We've received your resume.",
      },
      { nodeId: 4, parentId: 1, nodeType: 1, nodeName: "X-WIDGET" },
      {
        nodeId: 5,
        parentId: 4,
        nodeType: 11,
        nodeName: "#document-fragment",
        shadowRootType: "closed",
      },
      { nodeId: 6, parentId: 5, nodeType: 3, nodeName: "#text", nodeValue: "Inside a closed root" },
    ]);
    const text = await readPageText(cdp, 7);
    assert.match(text, /Inside a closed root/);
    assert.doesNotMatch(text, /received your resume/);
  });
});
