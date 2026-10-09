import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectPageControls, pageSignature } from "./page-controls.ts";

import type { DomTreeNode } from "./tree-export.ts";

let nextId = 1;
function node(
  tag: string,
  props: Partial<DomTreeNode> = {},
  children: DomTreeNode[] = [],
): DomTreeNode {
  return { nodeId: nextId++, tag, children, ...props };
}

describe("collectPageControls", () => {
  it("finds buttons, links and button inputs, with text from their children", () => {
    const next = node("button", {}, [node("span", { text: "Save and continue" })]);
    const tree = node("body", {}, [
      node("form", {}, [
        node("input", { attrs: { type: "text" } }),
        next,
        node("input", { attrs: { type: "submit", value: "Submit" } }),
      ]),
      node("a", { attrs: { href: "/jobs" }, text: "All jobs" }),
    ]);
    const controls = collectPageControls(tree);
    assert.deepEqual(
      controls.map((c) => c.text || c.label),
      ["Save and continue", "Submit", "All jobs"],
    );
    assert.equal(controls[0]?.id, next.nodeId);
    assert.equal(controls[0]?.inForm, true);
    assert.equal(controls[2]?.inForm, false);
  });

  it("keeps iconic controls that only have an aria-label", () => {
    const arrow = node("button", { attrs: { "aria-label": "Next step" } });
    const [control] = collectPageControls(node("body", {}, [node("form", {}, [arrow])]));
    assert.equal(control?.label, "Next step");
  });

  it("reads a custom element that wraps a native button as one control", () => {
    const host = node("ukg-button", { attrs: { role: "button" }, text: "Apply now" }, [
      node("button", { attrs: { type: "button" } }, [node("span")]),
    ]);
    const controls = collectPageControls(node("body", {}, [host]));
    assert.deepEqual(
      controls.map((c) => [c.id, c.text]),
      [[host.nodeId, "Apply now"]],
    );
  });

  it("leaves out controls a person cannot see", () => {
    const tree = node("body", {}, [
      node("div", {}, [node("button", { text: "Agree", attrs: { "acorn-hidden": "true" } })]),
      node("button", { text: "Continue" }),
    ]);
    assert.deepEqual(
      collectPageControls(tree).map((c) => c.text),
      ["Continue"],
    );
  });

  it("never leaves every control covered by a dialog that holds none", () => {
    const covered = { "acorn-covered": "true" };
    const tree = node("body", {}, [
      node("button", { text: "Apply", attrs: covered }),
      node("button", { text: "Consent & Continue", attrs: covered }),
    ]);
    assert.deepEqual(
      collectPageControls(tree).map((c) => c.covered),
      [false, false],
    );
  });

  it("names an icon-only control by the entry around it", () => {
    const edit = node("button");
    const tree = node("body", {}, [
      node("div", {}, [
        node("div", { text: "Unnamed Major" }),
        node("div", { text: "Fields to fix: 1" }),
        edit,
      ]),
    ]);
    const [control] = collectPageControls(tree);
    assert.equal(control?.id, edit.nodeId);
    assert.equal(control?.near, "Unnamed Major Fields to fix: 1");
  });

  it("marks chrome regions and disabled controls, and sorts them last", () => {
    const tree = node("body", {}, [
      node("header", {}, [node("a", { attrs: { href: "/" }, text: "Home" })]),
      node("form", {}, [
        node("button", { text: "Continue", attrs: { disabled: "true" } }),
        node("button", { text: "Next" }),
      ]),
    ]);
    const controls = collectPageControls(tree);
    assert.deepEqual(
      controls.map((c) => c.text),
      ["Next", "Home", "Continue"],
    );
    assert.equal(controls[1]?.context, "header");
    assert.equal(controls[2]?.disabled, true);
  });

  it("skips links without an href and text inputs", () => {
    const tree = node("body", {}, [
      node("a", { text: "anchor only" }),
      node("input", { attrs: { type: "email" } }),
    ]);
    assert.deepEqual(collectPageControls(tree), []);
  });
});

describe("pageSignature", () => {
  const form = (value: string, extra: DomTreeNode[] = []) =>
    node("body", {}, [
      node("form", {}, [
        node("input", { attrs: { type: "text", name: "email", value } }),
        node("input", { attrs: { type: "submit", value: "Next" } }),
        ...extra,
      ]),
    ]);

  it("ignores values and error text on the same step", () => {
    const filled = pageSignature(form("a@b.c"), "https://x.test/apply?a=1", "");
    const flagged = pageSignature(
      form("", [node("div", { text: "Required" })]),
      "https://x.test/apply?a=2",
      "Required",
    );
    assert.equal(filled, flagged);
  });

  it("changes when the step asks for different fields", () => {
    const next = node("body", {}, [node("input", { attrs: { type: "text", name: "phone" } })]);
    assert.notEqual(
      pageSignature(form(""), "https://x.test/apply", ""),
      pageSignature(next, "https://x.test/apply", ""),
    );
  });

  it("falls back to page text when there are no fields", () => {
    const empty = node("body");
    assert.notEqual(
      pageSignature(empty, "https://x.test/a", "Senior Engineer"),
      pageSignature(empty, "https://x.test/a", "Thank you"),
    );
  });
});
