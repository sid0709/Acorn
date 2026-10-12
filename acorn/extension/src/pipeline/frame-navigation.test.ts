import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { watchFrameDocument } from "./frame-navigation.ts";

type Listener = (details: { tabId: number; frameId: number }) => void;

/** A chrome.* event that the test fires by hand. */
function fakeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    fire: (details: { tabId: number; frameId: number }) => {
      for (const listener of listeners) listener(details);
    },
    size: () => listeners.size,
  };
}

const TAB = 7;
/** Main document 0 holds frame 3, which holds the form frame 5; frame 9 is a widget in 5. */
const FRAMES = [
  { frameId: 0, parentFrameId: -1 },
  { frameId: 3, parentFrameId: 0 },
  { frameId: 5, parentFrameId: 3 },
  { frameId: 9, parentFrameId: 5 },
];

function installChrome() {
  const events = {
    onBeforeNavigate: fakeEvent(),
    onCompleted: fakeEvent(),
    onErrorOccurred: fakeEvent(),
  };
  const removed = fakeEvent();
  (globalThis as { chrome?: unknown }).chrome = {
    webNavigation: { ...events, getAllFrames: async () => FRAMES },
    tabs: { onRemoved: removed },
  };
  return events;
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("watchFrameDocument", () => {
  it("sees the form frame's own document leave, and its new one arrive", async () => {
    const events = installChrome();
    const watch = await watchFrameDocument(TAB, 5);
    assert.equal(watch.left(), false);
    events.onBeforeNavigate.fire({ tabId: TAB, frameId: 5 });
    assert.equal(watch.left(), true);
    const arrived = watch.arrived();
    events.onCompleted.fire({ tabId: TAB, frameId: 5 });
    await arrived;
    watch.stop();
    assert.equal(events.onBeforeNavigate.size(), 0);
  });

  it("counts a frame that holds the form leaving", async () => {
    const events = installChrome();
    const watch = await watchFrameDocument(TAB, 5);
    events.onBeforeNavigate.fire({ tabId: TAB, frameId: 3 });
    assert.equal(watch.left(), true);
    watch.stop();
  });

  it("ignores a frame inside the form, and other tabs", async () => {
    const events = installChrome();
    const watch = await watchFrameDocument(TAB, 5);
    events.onBeforeNavigate.fire({ tabId: TAB, frameId: 9 });
    events.onBeforeNavigate.fire({ tabId: TAB + 1, frameId: 5 });
    assert.equal(watch.left(), false);
    watch.stop();
  });
});
