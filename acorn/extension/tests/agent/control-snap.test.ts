import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickChildFrame } from "../../src/agent/control-snap.ts";

const frames = [
  { frameId: 0, parentFrameId: -1, url: "https://careers.example.com/job" },
  { frameId: 7, parentFrameId: 0, url: "https://ats.example.net/jobs/1?in_iframe=1" },
  { frameId: 9, parentFrameId: 0, url: "https://ats.example.net/forms/5" },
  { frameId: 12, parentFrameId: 9, url: "https://ats.example.net/forms/5/inner" },
];

describe("the frame an iframe element at the point holds", () => {
  it("is the only child of the document asked", async () => {
    const names = () => Promise.resolve("");
    assert.equal(await pickChildFrame(frames, 9, { name: "", src: "" }, names), 12);
  });

  it("is the child at the element's address when there are several, ignoring the fragment", async () => {
    const names = () => Promise.resolve("");
    assert.equal(
      await pickChildFrame(
        frames,
        0,
        { name: "", src: "https://ats.example.net/forms/5#top" },
        names,
      ),
      9,
    );
  });

  it("is the child named as the element names it when the addresses do not match", async () => {
    const asked: number[] = [];
    const names = (frameId: number) => {
      asked.push(frameId);
      return Promise.resolve(frameId === 7 ? "icims_content_iframe" : "icims_formFrame");
    };
    assert.equal(
      await pickChildFrame(frames, 0, { name: "icims_formFrame", src: "about:blank" }, names),
      9,
    );
    assert.deepEqual(asked.sort(), [7, 9]);
  });

  it("is none when the document has no child frame, or none matches", async () => {
    const names = () => Promise.resolve("other");
    assert.equal(await pickChildFrame(frames, 12, { name: "x", src: "" }, names), null);
    assert.equal(
      await pickChildFrame(frames, 0, { name: "x", src: "https://elsewhere/" }, names),
      null,
    );
  });
});
