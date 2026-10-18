/**
 * Talking to the frames of the tab: serializing the ones that have a page, and working out where an
 * element of a frame is on the screen. A click lands at a point of the tab's own viewport, so a point
 * measured in a frame has to be carried up through the frames that hold it. A child frame of another
 * origin cannot be reached from the page, so it announces itself to its parent with a message and the
 * parent, which knows which of its iframes sent it, says where that iframe sits.
 */

import {
  PREFILL_MESSAGE,
  type PrefillRequestMessage,
  type ProbeRead,
  type ScannedFrame,
  type SerializedFrame,
} from "./messages";
import { PREFILL_FRAME_TIMEOUT_MS, PREFILL_PROBE_READS, PREFILL_PROBE_WAIT_MS } from "./settings";

import type { DomNode } from "./dom-types";
import type { FrameScan } from "./fields";

/** A frame of the tab. */
export interface FrameInfo {
  frameId: number;
  parentFrameId: number;
  url: string;
}

/** A frame that has a page, serialized. */
export interface PageTree {
  frameId: number;
  url: string;
  title: string;
  tree: DomNode;
}

/** Asks a frame's content script something. It answers null when the frame has none or does not answer. */
export async function askFrame<T>(
  tabId: number,
  frameId: number,
  message: PrefillRequestMessage,
): Promise<T | null> {
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PREFILL_FRAME_TIMEOUT_MS),
  );
  const answer = chrome.tabs
    .sendMessage(tabId, message, { frameId })
    .then((response: T | undefined) => response ?? null)
    .catch(() => null);
  return Promise.race([answer, timeout]);
}

export async function listFrames(tabId: number): Promise<FrameInfo[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames ?? []).map((frame) => ({
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      url: frame.url,
    }));
  } catch {
    return [{ frameId: 0, parentFrameId: -1, url: "" }];
  }
}

/** What every frame that has a page says of its empty plain fields. */
export async function scanFrames(tabId: number, frames: FrameInfo[]): Promise<FrameScan[]> {
  const answers = await Promise.all(
    frames.map(async (frame) => ({
      frame,
      scanned: await askFrame<ScannedFrame>(tabId, frame.frameId, { type: PREFILL_MESSAGE.scan }),
    })),
  );
  const scans: FrameScan[] = [];
  for (const { frame, scanned } of answers) {
    if (scanned?.ok) scans.push({ frameId: frame.frameId, scan: scanned });
  }
  return scans;
}

/** One frame's page, serialized. Its elements are numbered until the next time any frame is serialized. */
export async function serializeFrame(tabId: number, frameId: number): Promise<PageTree | null> {
  const page = await askFrame<SerializedFrame>(tabId, frameId, { type: PREFILL_MESSAGE.serialize });
  return page?.ok ? { frameId, url: page.url, title: page.title, tree: page.tree } : null;
}

/** Where a child frame sits in its parent, or null when the parent could not say. */
async function offsetInParent(
  tabId: number,
  frame: FrameInfo,
  sleep: (ms: number) => Promise<void>,
): Promise<{ x: number; y: number } | null> {
  const token = crypto.randomUUID();
  const armed = await askFrame<{ ok: boolean }>(tabId, frame.parentFrameId, {
    type: PREFILL_MESSAGE.armProbe,
    token,
  });
  if (!armed?.ok) return null;
  await askFrame(tabId, frame.frameId, { type: PREFILL_MESSAGE.sendProbe, token });
  for (let read = 0; read < PREFILL_PROBE_READS; read += 1) {
    await sleep(PREFILL_PROBE_WAIT_MS);
    const seen = await askFrame<ProbeRead>(tabId, frame.parentFrameId, {
      type: PREFILL_MESSAGE.readProbe,
      token,
    });
    if (seen?.ok && seen.found) return { x: seen.x, y: seen.y };
  }
  return null;
}

/**
 * A point measured in a frame's viewport, carried up to the tab's. Null when a frame on the way could
 * not say where its child is: the field is then left to the model's own look.
 */
export async function toTabViewport(
  tabId: number,
  frames: FrameInfo[],
  frameId: number,
  point: { x: number; y: number },
  sleep: (ms: number) => Promise<void>,
): Promise<{ x: number; y: number } | null> {
  let current = frames.find((frame) => frame.frameId === frameId);
  let { x, y } = point;
  while (current && current.frameId !== 0) {
    const offset = await offsetInParent(tabId, current, sleep);
    if (!offset) return null;
    x += offset.x;
    y += offset.y;
    const parentId = current.parentFrameId;
    current = frames.find((frame) => frame.frameId === parentId);
  }
  return current ? { x, y } : null;
}
