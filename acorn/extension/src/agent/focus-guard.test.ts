import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import { nothingHasFocus, scrollsAPage } from "./focus-guard.ts";

describe("keys that scroll a page", () => {
  it("names the navigation keys, in any chord or sequence, and not the keys that edit or commit", () => {
    for (const keys of [
      "ArrowDown",
      "Home",
      "PageDown",
      "Space",
      "ArrowDown ArrowDown Enter",
      "Shift+ArrowUp",
    ]) {
      assert.equal(scrollsAPage(keys), true, keys);
    }
    for (const keys of ["Enter", "Tab", "Escape", "Control+a", "Backspace Backspace", "b"]) {
      assert.equal(scrollsAPage(keys), false, keys);
    }
  });
});

describe("nothingHasFocus", () => {
  const answering = (value: unknown) =>
    fakeCdp({ "Runtime.evaluate": () => ({ result: { value } }) });

  it("is true only when the page itself would take the key", async () => {
    assert.equal(await nothingHasFocus(answering(true)), true);
    assert.equal(await nothingHasFocus(answering(false)), false);
  });

  it("does not refuse a page that cannot be asked", async () => {
    assert.equal(await nothingHasFocus(fakeCdp()), false);
    const broken = fakeCdp({
      "Runtime.evaluate": () => {
        throw new Error("navigating");
      },
    });
    assert.equal(await nothingHasFocus(broken), false);
  });
});
