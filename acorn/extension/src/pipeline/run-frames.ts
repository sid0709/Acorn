import { RUN_FRAMES_MAX } from "./run-limits";

import type { DomTreeNode } from "@acorn/shared/tree-export";

/** Schemes of frames that hold no content of their own. */
const EMPTY_FRAME_SCHEMES = new Set(["about:", "data:", "blob:", "javascript:"]);

/** Where a frame was loaded from, without its query or fragment (which may carry tokens). */
function frameAddress(url: string): string {
  try {
    const parsed = new URL(url);
    if (EMPTY_FRAME_SCHEMES.has(parsed.protocol)) return "";
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "";
  }
}

/** Titles the page gives its iframes (the accessible name of an embedded widget). */
function iframeTitles(tree: DomTreeNode): string[] {
  const titles: string[] = [];
  const walk = (node: DomTreeNode) => {
    const title = node.tag === "iframe" ? node.attrs?.title?.trim() : "";
    if (title) titles.push(title);
    for (const child of node.children) walk(child);
  };
  walk(tree);
  return titles;
}

/**
 * The tab's embedded frames other than the one the run reads: an embedded
 * widget's own copy (a verification check, a payment box) is out of the read
 * frame's reach, but its address and title still say what it is. Facts only;
 * the decision model judges what they mean.
 */
export async function embeddedFrames(
  tabId: number,
  readFrameId: number | null,
  tree: DomTreeNode,
): Promise<string[]> {
  let addresses: string[] = [];
  try {
    const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
    addresses = frames
      .filter((frame) => frame.frameId !== (readFrameId ?? 0) && frame.frameId !== 0)
      .map((frame) => frameAddress(frame.url));
  } catch {
    // A restricted page lists no frames.
  }
  const titled = iframeTitles(tree).map((title) => `"${title}"`);
  return [...new Set([...titled, ...addresses].filter(Boolean))].slice(0, RUN_FRAMES_MAX);
}
