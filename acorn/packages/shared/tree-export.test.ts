import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LAYER_ATTR } from "./page-controls.ts";
import { extractVisiblePageText } from "./page-text.ts";
import { formatAnalyzeTrees, withoutHidden, type DomTreeNode } from "./tree-export.ts";

const node = (
  nodeId: number,
  text: string,
  children: DomTreeNode[] = [],
  hidden = false,
): DomTreeNode => ({
  nodeId,
  tag: "div",
  text,
  children,
  ...(hidden ? { attrs: { [LAYER_ATTR.hidden]: "true" } } : {}),
});

describe("withoutHidden", () => {
  it("leaves out a panel a person cannot see, with everything inside it", () => {
    const tree = node(1, "", [
      node(2, "Your details"),
      node(
        3,
        "We just need to verify that you are human.",
        [node(4, "Enter the security code")],
        true,
      ),
    ]);
    const text = extractVisiblePageText(formatAnalyzeTrees(withoutHidden(tree)).pure);
    assert.ok(text.includes("Your details"));
    assert.ok(!text.includes("security code"));
    assert.ok(!text.includes("verify that you are human"));
  });

  it("keeps the whole tree when nothing is hidden, and does not change the original", () => {
    const tree = node(1, "", [node(2, "Visible")]);
    assert.equal(withoutHidden(tree).children.length, 1);
    const hiddenTree = node(1, "", [node(2, "Gone", [], true)]);
    withoutHidden(hiddenTree);
    assert.equal(hiddenTree.children.length, 1);
  });
});
