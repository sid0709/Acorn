/**
 * The marks a settled (blue) stretch and a planned point are placed by: the page's controls, and where
 * each one sits on the page. A MutationObserver and a ResizeObserver in the page keep the list current
 * (`control-marks-page.ts`); nothing here asks a model. The difference of two lists is where the form
 * moved: something appeared or went, and the controls below it moved with it. The stretches the model
 * settled follow that move (`placeSpans`), and a point bound to a control follows the control
 * (`markMove`), instead of a picture of its surroundings being searched for again.
 *
 * Everything here is pure, in whatever pixels the lists are in (the page's CSS pixels, or the
 * screenshot's after `scaleMoves`).
 */

/** A control moved at least this far (pixels) counts as the form having moved. */
export const MARK_MOVE_PX = 2;
/** How many controls one page reports. Past this the rest are not marks. */
export const MAX_CONTROL_MARKS = 400;
/** How often the run reads the list the page is already keeping. */
export const CONTROL_MARK_POLL_MS = 250;
/**
 * The tallest a field may be (CSS pixels) for the box round a control to be called its field: a box
 * taller than that is a section of the page, and a point anywhere in it is not on the control.
 */
export const FIELD_MAX_HEIGHT_PX = 240;
/**
 * After an action that changes the page, the run waits until the page has been quiet for this long, but at
 * least `QUIET_MIN_MS` and no longer than the fixed pause it replaces: a page that answers at once is not
 * waited on for the time a slow one needs, and a page that never goes quiet is waited on as before.
 */
export const QUIET_FOR_MS = 90;
export const QUIET_MIN_MS = 60;
/** How far a control may have grown or shrunk in height (CSS pixels) and still be the one a point was bound to. */
export const MARK_HEIGHT_TOLERANCE_PX = 3;
/** The same for width: a scrollbar that appears narrows a page by about 15, and its boxes with it. */
export const MARK_WIDTH_TOLERANCE_PX = 24;

export type ControlKind = "input" | "select" | "button" | "check" | "file" | "link";

/** A box on the page, from its top left. */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * One control of the page: an id that is the same control wherever it sits, its kind and its place, and the
 * field round it (the largest box that holds no other control). Moving a mark changes only its place.
 */
export type ControlMark = Box & {
  id: string;
  kind: ControlKind;
  box?: Box;
};

/**
 * A move of the form between two lists, in the old list's pixels. The controls from `at` down moved by
 * `dy`; what lay between `from` and `at` is where it happened, so nothing there is known to be as it was.
 */
export type LayoutMove = { from: number; at: number; dy: number };

/** A stretch of the page (a settled part), in the pixels of the list. */
type Stretch = { from: number; to: number };

/**
 * Where the form moved, from the controls' old and new places. The controls that are in both lists are
 * paired and read down the old page; each time the distance a control moved changes, the form moved
 * there: the controls from it down moved by that distance, and what lay between it and the last control
 * above that did not move is where something appeared (or went). Null when either list is empty (nothing
 * is known); empty when nothing moved. Several moves are several insertions, or removals, down the page.
 */
export function layoutMoves(before: ControlMark[], after: ControlMark[]): LayoutMove[] | null {
  if (before.length === 0 || after.length === 0) return null;
  const now = new Map(after.map((mark) => [mark.id, mark]));
  const pairs = before
    .flatMap((old) => {
      const cur = now.get(old.id);
      return cur ? [{ old, dy: cur.y - old.y }] : [];
    })
    .sort((a, b) => a.old.y - b.old.y || a.old.x - b.old.x);
  if (pairs.length === 0) return null;
  const moves: LayoutMove[] = [];
  let dy = 0;
  // How far down the old page the controls read so far reach: below it, up to the next control, is the gap.
  let reach = -Infinity;
  let floor = 0;
  for (const pair of pairs) {
    if (Math.abs(pair.dy - dy) > MARK_MOVE_PX) {
      const at = pair.old.y;
      // Nothing above the first control moved, or all of it did: with no control above it to say where
      // the move began, it began anywhere above it.
      const from = reach === -Infinity ? 0 : Math.min(Math.max(reach, floor), at);
      moves.push({ from, at, dy: pair.dy });
      dy = pair.dy;
      floor = at;
    }
    reach = Math.max(reach, pair.old.y + pair.old.h);
  }
  return moves;
}

/** The moves in other pixels (a list in CSS pixels, told to the agent in the screenshot's). */
export function scaleMoves(moves: LayoutMove[], scale: number): LayoutMove[] {
  return moves.map((move) => ({
    from: move.from * scale,
    at: move.at * scale,
    dy: move.dy * scale,
  }));
}

/** A piece of the old page that moved as one, to where it went. */
type Run = { from: number; to: number; dy: number };

/** The old page cut where the form moved: the part above the first move, then each part a move began. */
function runsOf(moves: LayoutMove[]): Run[] {
  const runs: Run[] = [];
  const ordered = moves
    .filter((move) => Number.isFinite(move.from + move.at + move.dy))
    .sort((a, b) => a.at - b.at);
  let start = 0;
  let dy = 0;
  let floor = 0;
  for (const move of ordered) {
    const from = Math.min(Math.max(move.from, floor), move.at);
    if (from > start) runs.push({ from: start, to: from, dy });
    start = move.at;
    dy = move.dy;
    floor = move.at;
  }
  runs.push({ from: start, to: Infinity, dy });
  return runs;
}

/**
 * Places stretches after the form moved. Each piece of a stretch that lies in a run of the old page goes
 * where the run went. A stretch the gap of a move cuts is cut there, so what appeared in the gap is not
 * settled until it is seen; a place that two pieces both land on (the form shrank over it) is not
 * settled either, since what is there is not known.
 */
export function placeSpans<T extends Stretch>(spans: T[], moves: LayoutMove[]): T[] {
  const runs = runsOf(moves);
  const pieces: (T & Stretch)[] = [];
  for (const span of spans) {
    for (const run of runs) {
      const lo = Math.max(span.from, run.from);
      const hi = Math.min(span.to, run.to);
      if (hi - lo <= 1) continue;
      const from = Math.max(lo + run.dy, 0);
      const to = Math.max(hi + run.dy, 0);
      if (to - from > 1) pieces.push({ ...span, from, to });
    }
  }
  return singlyCovered(pieces);
}

/** The parts of the line that exactly one of the pieces covers, in order, with those that touch made one. */
function singlyCovered<T extends Stretch>(pieces: T[]): T[] {
  const edges = [...new Set(pieces.flatMap((piece) => [piece.from, piece.to]))].sort(
    (a, b) => a - b,
  );
  const kept: T[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const lo = edges[i];
    const hi = edges[i + 1];
    if (lo === undefined || hi === undefined || hi - lo <= 0) continue;
    const covering = pieces.filter((piece) => piece.from <= lo && piece.to >= hi);
    const only = covering.length === 1 ? covering[0] : undefined;
    if (!only) continue;
    const last = kept[kept.length - 1];
    if (last && lo - last.to <= 1) {
      last.to = hi;
      continue;
    }
    kept.push({ ...only, from: lo, to: hi });
  }
  return kept.filter((piece) => piece.to - piece.from > 1);
}

/** Drops the part of each stretch that extends past `height`, and stretches that start there. */
export function cropSpans<T extends Stretch>(spans: T[], height: number): T[] {
  const out: T[] = [];
  for (const span of spans) {
    if (span.from >= height - 1) continue;
    const to = Math.min(span.to, height);
    if (to - span.from > 1) out.push({ ...span, to });
  }
  return out;
}

/** How far a control moved: along the page (`dy`) and across it (`dx`). */
export type MarkMove = { dx: number; dy: number };

/**
 * How far the control a point was bound to has moved: `planned` is the control as it sat when the point
 * was planned, `now` the control of the same id as it sits now. Null when it is not there, or is not the
 * size it was (a point aimed at a control that is now another shape may be off it), so the point is
 * found some other way.
 */
export function markMove(planned: Box, now: Box | null | undefined): MarkMove | null {
  if (!now) return null;
  if (Math.abs(now.h - planned.h) > MARK_HEIGHT_TOLERANCE_PX) return null;
  if (Math.abs(now.w - planned.w) > MARK_WIDTH_TOLERANCE_PX) return null;
  return { dx: now.x - planned.x, dy: now.y - planned.y };
}

/** Whether a move is a move at all, not the rounding of a position. */
export function moved(move: MarkMove): boolean {
  return Math.abs(move.dx) > MARK_MOVE_PX || Math.abs(move.dy) > MARK_MOVE_PX;
}

/** A list whose entries are all marks, or null: what the page sent is not trusted. */
export function parseMarks(value: unknown): ControlMark[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isMark);
}

export function isBox(value: unknown): value is Box {
  if (!value || typeof value !== "object") return false;
  const box = value as Box;
  return [box.x, box.y, box.w, box.h].every((n) => typeof n === "number" && Number.isFinite(n));
}

function isMark(value: unknown): value is ControlMark {
  if (!isBox(value)) return false;
  const mark = value as ControlMark;
  return (
    typeof mark.id === "string" && mark.id !== "" && (mark.box === undefined || isBox(mark.box))
  );
}

/** The list as the agent is told it: in the screenshot's pixels. */
export function marksForAgent(marks: ControlMark[], scale: number): ControlMark[] {
  const scaled = (box: Box): Box => ({
    x: box.x * scale,
    y: box.y * scale,
    w: box.w * scale,
    h: box.h * scale,
  });
  return marks.map((mark) => ({
    ...mark,
    ...scaled(mark),
    ...(mark.box ? { box: scaled(mark.box) } : {}),
  }));
}
