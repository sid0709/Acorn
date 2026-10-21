import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SLOW_LINK_BYTES_PER_SEC,
  forgetTransport,
  gzipBytes,
  rememberTransport,
  transferAllowanceMs,
  transportOf,
} from "../../src/agent/transport.ts";

describe("session transport", () => {
  it("packs bytes as gzip the server can unpack", async () => {
    const text = "x".repeat(10_000);
    const packed = await gzipBytes(new TextEncoder().encode(text));
    assert.ok(packed.byteLength < 200, `${packed.byteLength} bytes for 10 KB of the same letter`);
    const unpacked = await new Response(
      new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    assert.equal(unpacked, text);
  });

  it("gives a request time for its bytes on the slowest line", () => {
    assert.equal(transferAllowanceMs(0), 0);
    assert.equal(transferAllowanceMs(SLOW_LINK_BYTES_PER_SEC), 1000);
    assert.equal(
      transferAllowanceMs(1_200_000),
      Math.ceil(1_200_000 / SLOW_LINK_BYTES_PER_SEC) * 1000,
    );
  });

  it("keeps what the server offered for a run until the run ends", () => {
    assert.deepEqual(transportOf("run").can, {});
    rememberTransport("run", { gzip: true, blobs: true });
    const transport = transportOf("run");
    assert.deepEqual(transport.can, { gzip: true, blobs: true });
    transport.held.add("abc");
    assert.equal(transportOf("run"), transport);
    forgetTransport("run");
    assert.deepEqual(transportOf("run").can, {});
    assert.equal(transportOf("run").held.size, 0);
    forgetTransport("run");
  });
});
