import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { modelLatencyLines } from "../../src/sidebar/agent-files.ts";

describe("the summary's table of models", () => {
  it("gives each model its calls, timings, speed and cost, slowest first", () => {
    const lines = modelLatencyLines([
      {
        model: "openai/gpt-6-luna",
        latencyMs: 37_420,
        usage: { inputTokens: 18_306, outputTokens: 709, cost: 0.0026 },
        requests: [
          {
            connectMs: 8652,
            sendMs: 17_764,
            ttfbMs: 31_104,
            waitMs: 4688,
            readMs: 6315,
            sendBytesPerSec: 52_588,
          },
        ],
      },
      {
        kind: "decision",
        model: "gpt-6-luna",
        latencyMs: 1000,
        usage: { inputTokens: 1300, cost: 0.0001 },
        requests: [
          {
            connectMs: 0,
            sendMs: 10,
            ttfbMs: 1000,
            waitMs: 990,
            readMs: 0,
            sendBytesPerSec: 2_048_000,
          },
        ],
      },
      { kind: "decision", model: "gpt-6-luna", latencyMs: 3000, error: "timeout" },
    ]);
    assert.deepEqual(lines, [
      "  openai/gpt-6-luna (driving): 1 calls, $0.0026",
      "      median 37.4s, slowest 37.4s · first byte 31.1s (connect 8.7s, send 17.8s, wait 4.7s) · read 6.3s · 112 tokens/s out · upload 51 KB/s",
      "  gpt-6-luna (decision): 2 calls, 1 failed, $0.0001",
      "      median 1.0s, slowest 3.0s · first byte 1.0s (connect 0.0s, send 0.0s, wait 1.0s) · read 0.0s · 1300 tokens/s in · upload 2000 KB/s",
    ]);
  });

  it("names a call no model answered", () => {
    assert.match(
      modelLatencyLines([{ kind: "decision", latencyMs: 5, error: "x" }])[0],
      /^ {2}\(no answer\) \(decision\)/,
    );
  });
});
