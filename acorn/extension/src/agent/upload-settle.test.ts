import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import {
  UPLOAD_NETWORK_QUIET_MS,
  UPLOAD_PROCESS_MIN_MS,
  UPLOAD_PROCESS_POLL_MS,
  waitForUploadProcessing,
} from "./upload-settle.ts";

describe("waitForUploadProcessing", () => {
  it("enables the network domain and waits for in-flight XHR to finish", async () => {
    const cdp = fakeCdp();
    let now = 0;
    const sleep = async (ms: number) => {
      now += ms;
    };
    const done = waitForUploadProcessing(cdp, sleep);
    cdp.emit("Network.requestWillBeSent", { requestId: "a", type: "XHR" });
    await sleep(UPLOAD_PROCESS_MIN_MS);
    cdp.emit("Network.loadingFinished", { requestId: "a" });
    await sleep(UPLOAD_NETWORK_QUIET_MS + UPLOAD_PROCESS_POLL_MS);
    await done;
    assert.ok(cdp.of("Network.enable").length >= 1);
  });

  it("returns when no upload requests appear after the minimum wait", async () => {
    const cdp = fakeCdp();
    let now = 0;
    await waitForUploadProcessing(cdp, async (ms) => {
      now += ms;
    });
    assert.ok(now >= UPLOAD_PROCESS_MIN_MS + UPLOAD_NETWORK_QUIET_MS);
  });
});
