import type { PureNode } from "./tree-export";

export const PAGE_TEXT_MAX_CHARS = 20_000;

const SKIP_TAGS = new Set([
  "input",
  "select",
  "textarea",
  "button",
  "option",
  "script",
  "style",
  "noscript",
]);

function collectVisibleText(node: PureNode, parts: string[]): void {
  const tag = String(node.tag || "").toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  const text = typeof node.text === "string" ? node.text.replace(/\s+/g, " ").trim() : "";
  if (text) parts.push(text);
  for (const child of node.children) collectVisibleText(child, parts);
}

/** Visible page copy from the compact analyze tree. Skips form-control chrome. */
export function extractVisiblePageText(
  pure: PureNode,
  meta?: { title?: string; url?: string },
): string {
  const parts: string[] = [];
  collectVisibleText(pure, parts);
  const body = parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) return "";

  const header = [meta?.title?.trim(), meta?.url?.trim()].filter(Boolean).join("\n");
  const combined = header ? `${header}\n\n${body}` : body;
  return combined.length > PAGE_TEXT_MAX_CHARS ? combined.slice(0, PAGE_TEXT_MAX_CHARS) : combined;
}

/** One frame's visible copy, for a read that spans every frame of a tab. */
export interface FrameText {
  title: string;
  url: string;
  text: string;
  /** The tab's own document, not an embedded frame. */
  top: boolean;
}

function frameHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * Every frame's copy as one text for the model, which decides where the posting
 * is: a job board often embeds it in a frame of the company's careers page.
 * Empty and repeated frames are dropped. The frame with the most copy leads, so
 * the cap trims the page around a posting, not the posting itself.
 */
export function combineFrameTexts(frames: FrameText[]): string {
  const seen = new Set<string>();
  const kept = frames
    .map((frame) => ({ ...frame, text: frame.text.trim() }))
    .filter((frame) => {
      if (!frame.text || seen.has(frame.text)) return false;
      seen.add(frame.text);
      return true;
    })
    .sort((a, b) => b.text.length - a.text.length);
  if (!kept.length) return "";
  const page = frames.find((frame) => frame.top) ?? kept[0];
  const header = [page.title.trim(), page.url.trim()].filter(Boolean).join("\n");
  const sections = kept.map((frame) => {
    const where = [frame.title.trim(), frameHost(frame.url)].filter(Boolean).join(" · ");
    const label = frame.top ? "Page" : "Embedded frame";
    return `--- ${label}${where ? `: ${where}` : ""} ---\n${frame.text}`;
  });
  const combined = [header, ...sections].filter(Boolean).join("\n\n");
  return combined.length > PAGE_TEXT_MAX_CHARS ? combined.slice(0, PAGE_TEXT_MAX_CHARS) : combined;
}

/** The part of a clipped page kept from its end: one in this many characters. */
const CLIP_TAIL_SHARE = 3;
/** Marks where a clipped page's middle was left out. */
const CLIP_GAP = "\n…\n";

/**
 * A long page cut to max characters with both ends kept: a form answers the last
 * click (an error, a code prompt) beside its Submit, at the very bottom.
 */
export function clipEnds(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = Math.floor(max / CLIP_TAIL_SHARE);
  const head = max - tail - CLIP_GAP.length;
  return text.slice(0, head) + CLIP_GAP + text.slice(text.length - tail);
}
