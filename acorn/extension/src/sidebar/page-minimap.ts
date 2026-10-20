/**
 * The map of the page an agent Run is on, drawn in the sidebar's map card. The page is a column, scaled
 * across and down on their own scales (a page is far taller than wide, and at a true scale its controls
 * would be too thin to see). On it, from the bottom up: the parts the model settled in the accent, with a
 * bar at the left edge; the screens of the last survey as bars at the right edge; where the form moved as
 * a hatched band; where the plan first acts as a dashed line; the page's controls as blocks by kind; the
 * points of the plan as rings and dots by what became of them; and the window as an outlined box that
 * follows the scroll. The colors are the design system's tokens, resolved through the canvas's own style,
 * so the picture follows the theme.
 */

import {
  RUN_MAP_PHASE,
  RUN_POINT_STATE,
  type RunMap,
  type RunMapPhase,
  type RunMapPoint,
} from "@acorn/shared/run-types";

/** The map's height (CSS pixels); its width is the card's. */
export const MAP_HEIGHT_PX = 240;
/** How wide the page's column is drawn: as wide as the card allows, between these. */
const COLUMN_MIN_PX = 96;
const COLUMN_MAX_PX = 168;
/** Room at the column's right for the page's own pixel marks. */
const AXIS_PX = 44;
/** The page's pixel marks come every this many page pixels. */
const GRID_STEP_PAGE_PX = 1000;
/** The bars at the column's edges: the settled parts at the left, the survey's screens at the right. */
const EDGE_BAR_PX = 3;
/** The least a control is drawn as, so a thin one still shows. */
const CONTROL_MIN_W_PX = 2;
const CONTROL_MIN_H_PX = 1.5;
/** A point's dot or ring, the halo round the one being acted on, and the ring round one that moved. */
const POINT_RADIUS_PX = 3;
const CURRENT_HALO_PX = 7;
const MOVED_RING_PX = 5.5;
const RING_LINE_PX = 1.5;
/** The hatching of a band where the form moved, and the dashes of the line where the plan starts. */
const HATCH_STEP_PX = 4;
const DASH_PX = 3;
/** The window's outline. */
const WINDOW_LINE_PX = 2;
/** How strongly the settled parts, the window's glass, the controls, the halo and the hatching are painted. */
const SETTLED_ALPHA = 0.22;
const GLASS_ALPHA = 0.25;
const CONTROL_ALPHA = 0.9;
const HALO_ALPHA = 0.4;
const HATCH_ALPHA = 0.8;

/** The tokens the picture is painted in, by what each paints. */
const TOKEN = {
  track: "--color-background-muted",
  edge: "--color-border-emphasized",
  grid: "--color-chart-grid",
  label: "--color-text-secondary",
  settled: "--color-accent",
  taken: "--color-chart-accent",
  reused: "--color-chart-neutral",
  moved: "--color-chart-caution",
  fence: "--color-text-secondary",
  input: "--color-chart-neutral",
  select: "--color-chart-violet",
  button: "--color-chart-accent",
  check: "--color-chart-neutral",
  file: "--color-chart-caution",
  pending: "--color-text-primary",
  current: "--color-accent",
  done: "--color-chart-positive",
  failed: "--color-chart-critical",
  skipped: "--color-chart-neutral",
  window: "--color-text-primary",
  glass: "--color-background-surface",
} as const;
type Paint = Record<keyof typeof TOKEN, string>;

/** The control kinds the map draws, and what each is painted in. A link is left out: a page has many and a plan rarely aims at one. */
const CONTROL_PAINT: Record<string, keyof typeof TOKEN> = {
  input: "input",
  select: "select",
  button: "button",
  check: "check",
  file: "file",
};

/** What the run is doing, as the card says it. */
export const PHASE_LABEL: Record<RunMapPhase, string> = {
  [RUN_MAP_PHASE.starting]: "Starting",
  [RUN_MAP_PHASE.looking]: "Looking at the page",
  [RUN_MAP_PHASE.thinking]: "Asking the model",
  [RUN_MAP_PHASE.acting]: "Acting",
  [RUN_MAP_PHASE.waiting]: "Waiting for you",
  [RUN_MAP_PHASE.ended]: "Ended",
};

/** The legend under the map: each mark and what it means, in the order the card lists them. */
export const MAP_LEGEND = [
  { mark: "settled", label: "Settled" },
  { mark: "window", label: "Window" },
  { mark: "taken", label: "Screen photographed" },
  { mark: "reused", label: "Screen reused" },
  { mark: "moved", label: "Form moved here" },
  { mark: "fence", label: "Plan starts" },
  { mark: "input", label: "Text box" },
  { mark: "select", label: "Dropdown" },
  { mark: "button", label: "Button" },
  { mark: "check", label: "Check" },
  { mark: "file", label: "File" },
  { mark: "pending", label: "Point to do" },
  { mark: "current", label: "Doing now" },
  { mark: "done", label: "Done" },
  { mark: "failed", label: "Failed" },
  { mark: "skipped", label: "Skipped" },
  { mark: "point-moved", label: "Moved with its control" },
] as const;

/** The part of the page that is settled, 0 to 1. */
export function settledShare(map: RunMap): number {
  if (!(map.pageHeight > 0)) return 0;
  const covered = map.settled.reduce(
    (sum, span) => sum + Math.max(0, Math.min(span.to, map.pageHeight) - Math.max(span.from, 0)),
    0,
  );
  return Math.min(1, covered / map.pageHeight);
}

function count(points: RunMapPoint[], state: RunMapPoint["state"]): number {
  return points.filter((point) => point.state === state).length;
}

/** The map's caption: its numbers in one line, and what a person who cannot see the picture is told. */
export function mapCaption(map: RunMap | null): string {
  if (!map) return "No run on this tab yet. Press Run and the page appears here.";
  const parts = [
    `Page ${Math.round(map.pageHeight)} px`,
    `window at ${Math.round(map.viewTop)}–${Math.round(map.viewTop + map.viewHeight)}`,
    `${Math.round(settledShare(map) * 100)}% settled`,
  ];
  if (map.controls.length > 0) parts.push(`${map.controls.length} controls`);
  if (map.points.length > 0) {
    let points = `points ${count(map.points, RUN_POINT_STATE.done)}/${map.points.length} done`;
    const failed = count(map.points, RUN_POINT_STATE.failed);
    const skipped = count(map.points, RUN_POINT_STATE.skipped);
    const moved = map.points.filter((point) => point.moved).length;
    if (failed > 0) points += `, ${failed} failed`;
    if (skipped > 0) points += `, ${skipped} skipped`;
    if (moved > 0) points += `, ${moved} moved`;
    parts.push(points);
  }
  if (map.screens.length > 0) {
    const reused = map.screens.filter((screen) => screen.reused).length;
    let screens = `survey ${map.screens.length - reused} photographed`;
    if (reused > 0) screens += `, ${reused} reused`;
    parts.push(screens);
  }
  if (map.moves.length > 0) {
    parts.push(`form moved ${map.moves.length === 1 ? "once" : `${map.moves.length} times`}`);
  }
  return parts.join(" · ");
}

/**
 * The tokens as colors a canvas can take. A token is `light-dark(...)`, which only an element resolves:
 * the canvas's own color is set to each token in turn and read back resolved.
 */
function resolvePaint(canvas: HTMLCanvasElement): Paint {
  const saved = canvas.style.color;
  const style = getComputedStyle(canvas);
  const out = {} as Paint;
  for (const [key, token] of Object.entries(TOKEN) as [keyof typeof TOKEN, string][]) {
    canvas.style.color = `var(${token})`;
    out[key] = style.color;
  }
  canvas.style.color = saved;
  return out;
}

/** Where the page lands on the canvas: the column's place, and the scales across and down. */
type Geometry = {
  left: number;
  width: number;
  sx: number;
  sy: number;
  x: (page: number) => number;
  y: (page: number) => number;
};

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
}

function drawGrid(
  context: CanvasRenderingContext2D,
  map: RunMap,
  g: Geometry,
  paint: Paint,
  font: string,
): void {
  context.font = font;
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (let page = GRID_STEP_PAGE_PX; page < map.pageHeight; page += GRID_STEP_PAGE_PX) {
    const at = Math.round(g.y(page)) + 0.5;
    context.strokeStyle = paint.grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(g.left, at);
    context.lineTo(g.left + g.width, at);
    context.stroke();
    context.fillStyle = paint.label;
    context.fillText(`${page / GRID_STEP_PAGE_PX}k`, g.left + g.width + EDGE_BAR_PX + 2, at);
  }
}

function drawSettled(context: CanvasRenderingContext2D, map: RunMap, g: Geometry, paint: Paint) {
  context.fillStyle = paint.settled;
  for (const span of map.settled) {
    const top = g.y(span.from);
    const height = Math.max(1, (span.to - span.from) * g.sy);
    context.globalAlpha = SETTLED_ALPHA;
    context.fillRect(g.left, top, g.width, height);
    context.globalAlpha = 1;
    context.fillRect(g.left, top, EDGE_BAR_PX, height);
  }
}

function drawScreens(context: CanvasRenderingContext2D, map: RunMap, g: Geometry, paint: Paint) {
  for (const screen of map.screens) {
    context.fillStyle = screen.reused ? paint.reused : paint.taken;
    context.fillRect(
      g.left + g.width - EDGE_BAR_PX,
      g.y(screen.top),
      EDGE_BAR_PX,
      Math.max(1, screen.height * g.sy),
    );
  }
}

/** A band where the form moved: what appeared or went there has not been seen, so it is hatched. */
function drawMoves(context: CanvasRenderingContext2D, map: RunMap, g: Geometry, paint: Paint) {
  for (const move of map.moves) {
    const top = g.y(Math.min(move.from, move.at));
    const height = Math.max(2, Math.abs(move.at - move.from) * g.sy);
    context.save();
    context.beginPath();
    context.rect(g.left, top, g.width, height);
    context.clip();
    context.globalAlpha = HATCH_ALPHA;
    context.strokeStyle = paint.moved;
    context.lineWidth = 1;
    context.beginPath();
    for (let d = -height; d < g.width + height; d += HATCH_STEP_PX) {
      context.moveTo(g.left + d, top + height);
      context.lineTo(g.left + d + height, top);
    }
    context.stroke();
    context.restore();
  }
}

function drawFence(context: CanvasRenderingContext2D, map: RunMap, g: Geometry, paint: Paint) {
  if (map.fence == null) return;
  const at = Math.round(g.y(map.fence)) + 0.5;
  context.strokeStyle = paint.fence;
  context.lineWidth = 1;
  context.setLineDash([DASH_PX, DASH_PX]);
  context.beginPath();
  context.moveTo(g.left, at);
  context.lineTo(g.left + g.width, at);
  context.stroke();
  context.setLineDash([]);
}

function drawControls(context: CanvasRenderingContext2D, map: RunMap, g: Geometry, paint: Paint) {
  context.globalAlpha = CONTROL_ALPHA;
  for (const control of map.controls) {
    const key = CONTROL_PAINT[control.kind];
    if (!key) continue;
    context.fillStyle = paint[key];
    context.fillRect(
      g.x(control.x),
      g.y(control.y),
      Math.max(CONTROL_MIN_W_PX, control.w * g.sx),
      Math.max(CONTROL_MIN_H_PX, control.h * g.sy),
    );
  }
  context.globalAlpha = 1;
}

function drawPoint(
  context: CanvasRenderingContext2D,
  point: RunMapPoint,
  g: Geometry,
  paint: Paint,
): void {
  const x = g.x(point.x);
  const y = g.y(point.y);
  if (point.moved) {
    context.strokeStyle = paint.moved;
    context.lineWidth = 1;
    circle(context, x, y, MOVED_RING_PX);
    context.stroke();
  }
  switch (point.state) {
    case RUN_POINT_STATE.current:
      context.globalAlpha = HALO_ALPHA;
      context.fillStyle = paint.current;
      circle(context, x, y, CURRENT_HALO_PX);
      context.fill();
      context.globalAlpha = 1;
      circle(context, x, y, POINT_RADIUS_PX + 0.5);
      context.fill();
      return;
    case RUN_POINT_STATE.done:
      context.fillStyle = paint.done;
      circle(context, x, y, POINT_RADIUS_PX);
      context.fill();
      return;
    case RUN_POINT_STATE.failed:
      context.fillStyle = paint.failed;
      circle(context, x, y, POINT_RADIUS_PX + 0.5);
      context.fill();
      context.strokeStyle = paint.pending;
      context.lineWidth = 1;
      context.stroke();
      return;
    case RUN_POINT_STATE.skipped:
      context.strokeStyle = paint.skipped;
      context.lineWidth = RING_LINE_PX;
      circle(context, x, y, POINT_RADIUS_PX);
      context.stroke();
      return;
    default:
      context.strokeStyle = paint.pending;
      context.lineWidth = RING_LINE_PX;
      circle(context, x, y, POINT_RADIUS_PX);
      context.stroke();
  }
}

function drawPoints(context: CanvasRenderingContext2D, map: RunMap, g: Geometry, paint: Paint) {
  // The one being acted on is drawn last, over the rest.
  const ordered = [...map.points].sort((a, b) =>
    a.state === RUN_POINT_STATE.current ? 1 : b.state === RUN_POINT_STATE.current ? -1 : 0,
  );
  for (const point of ordered) drawPoint(context, point, g, paint);
}

function drawWindow(context: CanvasRenderingContext2D, map: RunMap, g: Geometry, paint: Paint) {
  const top = Math.max(0, g.y(map.viewTop));
  const height = Math.max(3, map.viewHeight * g.sy);
  context.globalAlpha = GLASS_ALPHA;
  context.fillStyle = paint.glass;
  context.fillRect(g.left, top, g.width, height);
  context.globalAlpha = 1;
  context.lineWidth = WINDOW_LINE_PX;
  context.strokeStyle = paint.window;
  const inset = WINDOW_LINE_PX / 2;
  context.strokeRect(
    g.left + inset,
    top + inset,
    g.width - WINDOW_LINE_PX,
    Math.max(1, height - WINDOW_LINE_PX),
  );
}

/**
 * Draws the map on the canvas, as wide as `width` (CSS pixels), sharp at any pixel density. A null map is
 * an empty page: the column alone, so the card looks the same before a run as during one.
 */
export function drawRunMap(canvas: HTMLCanvasElement, map: RunMap | null, width: number): void {
  const density = window.devicePixelRatio || 1;
  const w = Math.max(COLUMN_MIN_PX + AXIS_PX, Math.round(width));
  canvas.width = Math.round(w * density);
  canvas.height = Math.round(MAP_HEIGHT_PX * density);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${MAP_HEIGHT_PX}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(density, 0, 0, density, 0, 0);
  context.clearRect(0, 0, w, MAP_HEIGHT_PX);
  const paint = resolvePaint(canvas);
  const style = getComputedStyle(canvas);
  const font = `${style.getPropertyValue("--font-size-xs").trim() || style.fontSize} ${style.fontFamily}`;
  const column = Math.min(COLUMN_MAX_PX, Math.max(COLUMN_MIN_PX, w - AXIS_PX));
  const left = Math.floor((w - column - AXIS_PX) / 2);

  context.fillStyle = paint.track;
  context.fillRect(left, 0, column, MAP_HEIGHT_PX);
  if (map) {
    const sx = column / Math.max(1, map.pageWidth);
    const sy = MAP_HEIGHT_PX / Math.max(1, map.pageHeight);
    const g: Geometry = {
      left,
      width: column,
      sx,
      sy,
      x: (page) => left + page * sx,
      y: (page) => page * sy,
    };
    drawGrid(context, map, g, paint, font);
    drawSettled(context, map, g, paint);
    drawScreens(context, map, g, paint);
    drawMoves(context, map, g, paint);
    drawFence(context, map, g, paint);
    drawControls(context, map, g, paint);
    drawPoints(context, map, g, paint);
    drawWindow(context, map, g, paint);
  }
  context.lineWidth = 1;
  context.strokeStyle = paint.edge;
  context.strokeRect(left + 0.5, 0.5, column - 1, MAP_HEIGHT_PX - 1);
}
