/**
 * Where the page lands down the map's column. A long page is mostly what is not the form (a job description
 * above it, a footer below), so a stretch with nothing on it is folded to a thin band and the rest shares the
 * height: a form at the foot of a page 7,000 pixels tall is drawn across the map, not in its last tenth. A page
 * with nothing on it yet is drawn whole, top to bottom. The mapping is the same both ways (`mapY`, `pageY`) and
 * keeps the page's order, so the window, the settled stretches and the screens are drawn through it as they are.
 */

/** A stretch of the page with nothing on it this tall (CSS pixels) or taller is folded. */
export const FOLD_MIN_PAGE_PX = 640;
/** Room kept round what is on the page (CSS pixels), so nothing is drawn against a fold. */
export const FOLD_PAD_PAGE_PX = 80;
/** How tall a fold is drawn (map pixels). */
export const FOLD_BAND_PX = 16;
/** The most of the map's height the folds may take: past it, only the longest stretches are folded. */
export const FOLD_MAX_SHARE = 0.3;
/** The most map pixels a page pixel is drawn as: a short form is not drawn larger than it is. */
export const MAP_MAX_SCALE = 1;

/** A stretch of the page and where it is drawn: as it is, or folded to a band. */
export interface MapSegment {
  from: number;
  to: number;
  top: number;
  height: number;
  folded: boolean;
}

export interface MapLayout {
  /** How tall the map is drawn (map pixels): at most the height it was given. */
  height: number;
  segments: MapSegment[];
}

type Stretch = { from: number; to: number };

/** What is on the page, each with room round it, joined where less than a fold lies between. */
function clustersOf(pageHeight: number, marks: { y: number; h: number }[]): Stretch[] {
  const spans = marks
    .filter((mark) => Number.isFinite(mark.y) && mark.y < pageHeight && mark.y + mark.h > 0)
    .map((mark) => ({
      from: Math.max(0, mark.y - FOLD_PAD_PAGE_PX),
      to: Math.min(pageHeight, mark.y + Math.max(0, mark.h) + FOLD_PAD_PAGE_PX),
    }))
    .sort((a, b) => a.from - b.from);
  const joined: Stretch[] = [];
  for (const span of spans) {
    const last = joined[joined.length - 1];
    if (last && span.from - last.to < FOLD_MIN_PAGE_PX) last.to = Math.max(last.to, span.to);
    else joined.push({ ...span });
  }
  return joined;
}

/**
 * Lays the page down a map at most `maxHeight` pixels tall. `marks` are what is on the page (its controls and
 * the points of the plan, CSS pixels): the stretches between them, and above and below them, are folded.
 */
export function layoutMap(
  pageHeight: number,
  marks: { y: number; h: number }[],
  maxHeight: number,
): MapLayout {
  const page = Math.max(1, pageHeight);
  const room = Math.max(1, maxHeight);
  const clusters = clustersOf(page, marks);
  const gaps: Stretch[] = [];
  let reach = 0;
  for (const cluster of clusters) {
    if (cluster.from - reach >= FOLD_MIN_PAGE_PX) gaps.push({ from: reach, to: cluster.from });
    reach = cluster.to;
  }
  if (clusters.length > 0 && page - reach >= FOLD_MIN_PAGE_PX) gaps.push({ from: reach, to: page });
  const most = Math.floor((room * FOLD_MAX_SHARE) / FOLD_BAND_PX);
  const folds = gaps
    .sort((a, b) => b.to - b.from - (a.to - a.from))
    .slice(0, most)
    .sort((a, b) => a.from - b.from);
  const shown = page - folds.reduce((sum, fold) => sum + fold.to - fold.from, 0);
  const scale = Math.min(MAP_MAX_SCALE, (room - folds.length * FOLD_BAND_PX) / Math.max(1, shown));
  const segments: MapSegment[] = [];
  let top = 0;
  let at = 0;
  const show = (to: number) => {
    if (to <= at) return;
    const height = (to - at) * scale;
    segments.push({ from: at, to, top, height, folded: false });
    top += height;
    at = to;
  };
  for (const fold of folds) {
    show(fold.from);
    segments.push({ from: fold.from, to: fold.to, top, height: FOLD_BAND_PX, folded: true });
    top += FOLD_BAND_PX;
    at = fold.to;
  }
  show(page);
  return { height: Math.min(room, top), segments };
}

/** A length or a place on the page in a few characters: 640, 3.9k. */
export function formatPagePx(px: number): string {
  return px >= 1000 ? `${(px / 1000).toFixed(1)}k` : String(Math.round(px));
}

/** Where a place on the page (CSS pixels from its top) is drawn on the map. */
export function mapY(layout: MapLayout, y: number): number {
  const first = layout.segments[0];
  if (!first) return 0;
  if (y <= first.from) return first.top;
  for (const segment of layout.segments) {
    if (y < segment.to) {
      return segment.top + ((y - segment.from) / (segment.to - segment.from)) * segment.height;
    }
  }
  const last = layout.segments[layout.segments.length - 1] ?? first;
  return last.top + last.height;
}

/** The place on the page a point of the map stands for. */
export function pageY(layout: MapLayout, y: number): number {
  const first = layout.segments[0];
  if (!first) return 0;
  if (y <= first.top) return first.from;
  for (const segment of layout.segments) {
    if (y < segment.top + segment.height) {
      return segment.from + ((y - segment.top) / segment.height) * (segment.to - segment.from);
    }
  }
  const last = layout.segments[layout.segments.length - 1] ?? first;
  return last.to;
}
