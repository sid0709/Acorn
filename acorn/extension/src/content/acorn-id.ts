/** Random bytes in this frame's stamp: enough that two frames of one tab never share it. */
const FRAME_STAMP_BYTES = 4;

function frameStamp(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(FRAME_STAMP_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The attribute this frame stamps its node ids under. A frame also reads the
 * same-origin frames inside it that have no content script of their own (yet), so
 * a page and its embedded frame can number the same elements, and at the same
 * time. Each frame keeps its own attribute: one frame's read never renumbers the
 * controls another frame is about to press or fill.
 */
export const ACORN_ID_ATTR = `data-acorn-id-${frameStamp()}`;

/** Whether the run has read this frame: its elements carry this frame's node ids. */
export function holdsAcornIds(): boolean {
  return document.querySelector(`[${ACORN_ID_ATTR}]`) != null;
}
