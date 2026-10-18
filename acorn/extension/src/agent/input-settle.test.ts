import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import { INPUT_DEBOUNCE_MS, INPUT_SETTLE_MAX_MS, watchInputEffects } from "./input-settle.ts";

/** A clock the sleeps advance, so a wait can be measured without waiting. */
function clock() {
  let now = 0;
  const real = Date.now;
  Date.now = () => now;
  return {
    sleep: async (ms: number) => void (now += ms),
    now: () => now,
    restore: () => void (Date.now = real),
  };
}

describe("watchInputEffects", () => {
  it("gives a page its beat and a quiet network before the step is looked at", async () => {
    const c = clock();
    try {
      const cdp = fakeCdp();
      const watch = await watchInputEffects(cdp);
      await watch.settle(c.sleep);
      assert.ok(c.now() >= INPUT_DEBOUNCE_MS, "the debounce is waited out");
    } finally {
      c.restore();
    }
  });

  it("waits for a request the typing started to finish", async () => {
    const c = clock();
    try {
      const cdp = fakeCdp();
      const watch = await watchInputEffects(cdp);
      cdp.emit("Network.requestWillBeSent", { requestId: "suggest", type: "XHR" });
      let sleeps = 0;
      const sleep = async (ms: number) => {
        await c.sleep(ms);
        sleeps += 1;
        if (sleeps === 6) cdp.emit("Network.loadingFinished", { requestId: "suggest" });
      };
      await watch.settle(sleep);
      assert.ok(sleeps >= 6, "it waited while the request was in flight");
      assert.ok(c.now() < INPUT_SETTLE_MAX_MS, "and stopped once the page was quiet");
    } finally {
      c.restore();
    }
  });

  it("gives up on a request that never ends", async () => {
    const c = clock();
    try {
      const cdp = fakeCdp();
      const watch = await watchInputEffects(cdp);
      cdp.emit("Network.requestWillBeSent", { requestId: "stuck", type: "Fetch" });
      await watch.settle(c.sleep);
      assert.ok(c.now() <= INPUT_SETTLE_MAX_MS + 200);
    } finally {
      c.restore();
    }
  });

  it("does not wait on images or other requests that do not decide what a list shows", async () => {
    const c = clock();
    try {
      const cdp = fakeCdp();
      const watch = await watchInputEffects(cdp);
      cdp.emit("Network.requestWillBeSent", { requestId: "pic", type: "Image" });
      await watch.settle(c.sleep);
      assert.ok(c.now() < 1_000);
    } finally {
      c.restore();
    }
  });
});
