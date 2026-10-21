import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UploadLane } from "../../src/agent/upload-lane.ts";

/** Lets every settled promise run its callbacks: the lane hands the line on a few microtasks after a result. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A piece of work that finishes when told to, and notes when it started. */
function job(order: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return {
    finish,
    work: () => {
      order.push(name);
      return done.then(() => name);
    },
  };
}

describe("UploadLane", () => {
  it("runs one request at a time, urgent ones before background ones", async () => {
    const lane = new UploadLane();
    const order: string[] = [];
    const first = job(order, "first");
    const photo = job(order, "photo");
    const step = job(order, "step");
    const results = [
      lane.run("background", first.work),
      lane.run("background", photo.work),
      lane.run("urgent", step.work),
    ];
    await settle();
    assert.deepEqual(order, ["first"]);
    assert.equal(lane.pending, 3);
    first.finish();
    await results[0];
    await settle();
    // The step jumped the photo, which was still waiting; the photo was not cut off since it had not begun.
    assert.deepEqual(order, ["first", "step"]);
    step.finish();
    await results[2];
    await settle();
    assert.deepEqual(order, ["first", "step", "photo"]);
    photo.finish();
    assert.deepEqual(await Promise.all(results), ["first", "photo", "step"]);
    assert.equal(lane.pending, 0);
  });

  it("goes on after a request fails", async () => {
    const lane = new UploadLane();
    await assert.rejects(
      lane.run("urgent", () => Promise.reject(new Error("down"))),
      /down/,
    );
    assert.equal(await lane.run("background", () => Promise.resolve("next")), "next");
  });
});
