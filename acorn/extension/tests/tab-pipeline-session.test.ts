import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXTENSION_BUILD } from "../src/build-version.ts";
import { readableProgress, tabPipelinesFromStored } from "../src/tab-pipeline-session.ts";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { RunMap } from "@acorn/shared/run-types";

/** A run's map as this build draws it. */
const MAP: RunMap = {
  phase: "acting",
  pageWidth: 1280,
  pageHeight: 6000,
  viewTop: 0,
  viewHeight: 800,
  settled: [{ from: 0, to: 800 }],
  controls: [],
  points: [],
  screens: [],
  moves: [],
};

/** The map as the build before the page map card kept it: no controls, points, screens or moves. */
const OLD_MAP = { pageHeight: 6000, viewTop: 0, viewHeight: 800, settled: [{ from: 0, to: 800 }] };

function running(map: unknown): PipelineProgress {
  return {
    phase: "running",
    message: "Filling",
    run: {
      runId: "r1",
      stage: "filling",
      startedAt: 1,
      page: 1,
      refills: 0,
      maxRefills: 0,
      map,
    } as never,
  };
}

describe("a tab's progress kept in the browser", () => {
  it("is read back when this build wrote it, with a map this build can draw", () => {
    const stored = { build: EXTENSION_BUILD, pipelines: { "7": running(MAP) } };
    assert.deepEqual(tabPipelinesFromStored(stored), { "7": running(MAP) });
  });

  it("is dropped when another build wrote it, or it is not what the key holds", () => {
    assert.deepEqual(
      tabPipelinesFromStored({ build: "0.0.0", pipelines: { "7": running(MAP) } }),
      {},
    );
    assert.deepEqual(
      tabPipelinesFromStored({ "7": running(MAP) }),
      {},
      "the flat map an older build kept",
    );
    assert.deepEqual(tabPipelinesFromStored(null), {});
    assert.deepEqual(tabPipelinesFromStored("nope"), {});
    assert.deepEqual(tabPipelinesFromStored({ build: EXTENSION_BUILD, pipelines: "nope" }), {});
  });

  it("leaves out a run's map that is not of this build's shape, and keeps the rest of the run", () => {
    const read = readableProgress(running(OLD_MAP));
    assert.equal(read.run?.map, undefined);
    assert.equal(read.run?.runId, "r1");
    assert.equal(read.phase, "running");
    assert.equal(
      readableProgress(running(MAP)).run?.map,
      MAP,
      "a map of this shape is kept as it is",
    );
    const idle: PipelineProgress = { phase: "idle", message: "Idle" };
    assert.equal(readableProgress(idle), idle, "no run, nothing to read");
    const stored = {
      build: EXTENSION_BUILD,
      pipelines: { "7": running(OLD_MAP), "8": running(MAP) },
    };
    assert.equal(tabPipelinesFromStored(stored)["7"]?.run?.map, undefined);
    assert.deepEqual(tabPipelinesFromStored(stored)["8"]?.run?.map, MAP);
  });
});
