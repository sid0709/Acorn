import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quietFor, type TabNetwork } from "./network-activity.ts";
import { RUN_NETWORK_LONG_REQUEST_MS } from "./run-limits.ts";

const NOW = 1_000_000;
const tab = (inFlight: [string, number][], lastActivity: number): TabNetwork => ({
  inFlight: new Map(inFlight),
  lastActivity,
});

describe("quietFor", () => {
  it("is not quiet while the page fetches what it will draw", () => {
    assert.equal(quietFor(tab([["form", NOW - 300]], NOW - 300), NOW), 0);
  });

  it("counts quiet from the last request that ended", () => {
    assert.equal(quietFor(tab([], NOW - 900), NOW), 900);
  });

  it("stops counting a long-lived connection from when it became one", () => {
    const opened = NOW - RUN_NETWORK_LONG_REQUEST_MS - 400;
    const state = tab([["poll", opened]], opened);
    assert.equal(quietFor(state, NOW), 400);
    assert.equal(state.inFlight.size, 0);
  });
});
