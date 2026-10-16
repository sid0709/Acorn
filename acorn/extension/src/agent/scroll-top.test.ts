import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrollToTop } from "./scroll-top.ts";

import type { Cdp } from "./cdp.ts";

describe("scrollToTop", () => {
  it("scrolls the page to its top at once, then waits for it to settle", async () => {
    const sent: { method: string; params?: { expression?: string } }[] = [];
    const slept: number[] = [];
    const cdp = {
      send: async (method: string, params?: { expression?: string }) =>
        void sent.push({ method, params }),
    } as unknown as Cdp;
    await scrollToTop(cdp, async (ms) => void slept.push(ms));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, "Runtime.evaluate");
    assert.match(sent[0].params?.expression ?? "", /top: 0/);
    assert.match(sent[0].params?.expression ?? "", /instant/);
    assert.equal(slept.length, 1);
  });

  it("does not fail the run when the page cannot be scrolled", async () => {
    const cdp = {
      send: async () => {
        throw new Error("the page is navigating");
      },
    } as unknown as Cdp;
    await scrollToTop(cdp, async () => undefined);
  });
});
