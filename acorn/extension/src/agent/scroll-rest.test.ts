import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import { SCROLL_REST_MAX_MS, waitForScrollRest } from "./scroll-rest.ts";

describe("waitForScrollRest", () => {
  it("waits for a scroll in motion to stop, then returns", async () => {
    const positions = [854, 800, 769, 769, 769];
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": () => ({ cssVisualViewport: { pageY: positions.shift() ?? 769 } }),
    });
    let slept = 0;
    await waitForScrollRest(cdp, async (ms) => void (slept += ms));
    assert.equal(cdp.of("Page.getLayoutMetrics").length, 4, "two reads in the same place end it");
    assert.ok(slept > 0);
  });

  it("returns at once for a page at rest", async () => {
    const cdp = fakeCdp({ "Page.getLayoutMetrics": () => ({ cssVisualViewport: { pageY: 300 } }) });
    await waitForScrollRest(cdp, async () => {});
    assert.equal(cdp.of("Page.getLayoutMetrics").length, 2);
  });

  it("gives up on a page that never stops, so a run is not held", async () => {
    let y = 0;
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": () => ({ cssVisualViewport: { pageY: (y += 50) } }),
    });
    let slept = 0;
    await waitForScrollRest(cdp, async (ms) => void (slept += ms));
    assert.ok(slept <= SCROLL_REST_MAX_MS + 100);
  });

  it("returns when the page cannot be asked", async () => {
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": () => {
        throw new Error("detached");
      },
    });
    await waitForScrollRest(cdp, async () => {});
  });
});
