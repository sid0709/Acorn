/**
 * The minimap of the page an agent Run is on, drawn in the sidebar's Now card: the page as a narrow
 * column like an editor's, the parts the model settled (will not come back to) painted in the accent
 * color, and the window as an outlined box that follows the scroll. The colors are the design system's
 * tokens, read from the canvas's own style, so the picture follows the theme.
 */

import type { RunMap } from "@acorn/shared/run-types";

/** The minimap's size in CSS pixels. */
export const MINIMAP_WIDTH_PX = 16;
export const MINIMAP_HEIGHT_PX = 120;
/** How wide the window box's outline is (CSS pixels). */
const MINIMAP_BOX_LINE_PX = 2;
/** The tokens the picture is painted in: the page, what is settled, the window's outline and its glass. */
const TOKEN = {
  track: "--color-background-muted",
  settled: "--color-accent",
  box: "--color-text-primary",
  glass: "--color-background-surface",
} as const;
/** How much of the window box shows what is under it. */
const GLASS_ALPHA = 0.35;

/** The part of the page that is settled, 0 to 1. */
export function settledShare(map: RunMap): number {
  if (!(map.pageHeight > 0)) return 0;
  const covered = map.settled.reduce(
    (sum, span) => sum + Math.max(0, Math.min(span.to, map.pageHeight) - Math.max(span.from, 0)),
    0,
  );
  return Math.min(1, covered / map.pageHeight);
}

/** What a person who cannot see the picture is told it shows. */
export function minimapLabel(map: RunMap): string {
  const settled = Math.round(settledShare(map) * 100);
  const at = Math.round((map.viewTop / Math.max(1, map.pageHeight)) * 100);
  return `Map of the page: ${settled}% settled; the window is ${at}% of the way down`;
}

/** The color of a token as the canvas sees it; the text color when the token is not defined. */
function color(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim() || style.color;
}

/** Draws the minimap on a canvas, sharp at any pixel density. */
export function drawPageMinimap(canvas: HTMLCanvasElement, map: RunMap): void {
  const density = window.devicePixelRatio || 1;
  canvas.width = Math.round(MINIMAP_WIDTH_PX * density);
  canvas.height = Math.round(MINIMAP_HEIGHT_PX * density);
  canvas.style.width = `${MINIMAP_WIDTH_PX}px`;
  canvas.style.height = `${MINIMAP_HEIGHT_PX}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(density, 0, 0, density, 0, 0);
  const style = getComputedStyle(canvas);
  const scale = MINIMAP_HEIGHT_PX / Math.max(1, map.pageHeight);

  context.fillStyle = color(style, TOKEN.track);
  context.fillRect(0, 0, MINIMAP_WIDTH_PX, MINIMAP_HEIGHT_PX);

  context.fillStyle = color(style, TOKEN.settled);
  for (const span of map.settled) {
    context.fillRect(
      0,
      span.from * scale,
      MINIMAP_WIDTH_PX,
      Math.max(1, (span.to - span.from) * scale),
    );
  }

  context.fillStyle = color(style, TOKEN.box);
  for (const y of map.marks ?? []) {
    context.fillRect(0, y * scale, MINIMAP_WIDTH_PX, 1);
  }

  const top = Math.max(0, map.viewTop * scale);
  const height = Math.max(3, map.viewHeight * scale);
  context.globalAlpha = GLASS_ALPHA;
  context.fillStyle = color(style, TOKEN.glass);
  context.fillRect(0, top, MINIMAP_WIDTH_PX, height);
  context.globalAlpha = 1;
  context.lineWidth = MINIMAP_BOX_LINE_PX;
  context.strokeStyle = color(style, TOKEN.box);
  const inset = MINIMAP_BOX_LINE_PX / 2;
  context.strokeRect(
    inset,
    top + inset,
    MINIMAP_WIDTH_PX - MINIMAP_BOX_LINE_PX,
    Math.max(1, height - MINIMAP_BOX_LINE_PX),
  );
}
