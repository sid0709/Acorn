/**
 * The run's view of the page's controls (`control-marks.ts` says what for): it reads the list the page
 * keeps, remembers the list the agent was last told of so the next move of the form is measured from it,
 * and asks the page where a control is now, whether a point is on its field, and whether the page has
 * gone quiet. Every call to the page can fail (it is mid-navigation); none of them may fail the run, so a
 * call that does answers "do not know" and the run does what it did before there were marks.
 */

import {
  QUIET_FOR_MS,
  QUIET_MIN_MS,
  isBox,
  layoutMoves,
  markMove,
  parseMarks,
  shiftAt,
  type ControlMark,
  type LayoutMove,
  type MarkMove,
} from "./control-marks";
import {
  CONTROL_MARKS_MISSING,
  controlMarkHoldsScript,
  controlMarkInstallScript,
  controlMarkQuietScript,
  controlMarkReadScript,
  controlMarkWhereScript,
} from "./control-marks-page";

import type { Cdp } from "./cdp";
import type { AgentMarkRef } from "@acorn/shared/agent-contract";

type Evaluated = { result?: { value?: unknown } };

function isMissing(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { missing?: unknown }).missing === CONTROL_MARKS_MISSING.missing
  );
}

async function evaluate(cdp: Cdp, expression: string, awaitPromise: boolean): Promise<unknown> {
  const answer = await cdp.send<Evaluated>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    ...(awaitPromise ? { awaitPromise: true } : {}),
  });
  return answer.result?.value;
}

/** Runs a call in the page. A page that has not got the script (a new document) gets it, and is asked again. */
async function ask(cdp: Cdp, script: () => string, awaitPromise = false): Promise<unknown> {
  const first = await evaluate(cdp, script(), awaitPromise);
  if (!isMissing(first)) return first;
  await evaluate(cdp, controlMarkInstallScript(), false);
  const again = await evaluate(cdp, script(), awaitPromise);
  return isMissing(again) ? undefined : again;
}

/**
 * Waits for the page to go quiet, for at most `maxMs` and not less than `floorMs` (the least that is safe to
 * wait, `QUIET_MIN_MS` unless the caller needs more). Says whether it did: when it did not know (the tab is
 * hidden, or the page was mid-navigation) the caller waits `maxMs` itself, as it always did.
 */
export async function waitForQuiet(
  cdp: Cdp,
  maxMs: number,
  floorMs = QUIET_MIN_MS,
): Promise<boolean> {
  try {
    const waited = await ask(
      cdp,
      () =>
        controlMarkQuietScript(
          Math.min(Math.max(floorMs, QUIET_MIN_MS), maxMs),
          QUIET_FOR_MS,
          maxMs,
        ),
      true,
    );
    return typeof waited === "number" && waited >= 0;
  } catch {
    return false;
  }
}

/** Two lists say the same: the same controls in the same places, showing the same (the sidebar reads that). */
function sameMarks(a: ControlMark[], b: ControlMark[]): boolean {
  return (
    a.length === b.length &&
    a.every((mark, i) => {
      const other = b[i];
      return (
        other &&
        mark.id === other.id &&
        mark.x === other.x &&
        mark.y === other.y &&
        mark.value === other.value &&
        mark.checked === other.checked &&
        mark.empty === other.empty &&
        mark.invalid === other.invalid
      );
    })
  );
}

/** Keeps the page's control list for one run. All places are the page's CSS pixels. */
/** How often the list is read while waiting for the form to stop moving. */
const FORM_SETTLE_POLL_MS = 100;

export class ControlWatch {
  /** The latest list the page gave. */
  marks: ControlMark[] = [];
  /** The list the agent was last told of: the form moved where the latest list differs from it. */
  private told: ControlMark[] = [];
  /** The list at the last survey: a plan's points are measured on it, so a point bound to no control is placed from it. */
  private surveyed: ControlMark[] = [];
  private version = -1;

  /** Another page: the lists describe the last one. */
  forget(): void {
    this.marks = [];
    this.told = [];
    this.surveyed = [];
    this.version = -1;
  }

  /**
   * Waits until the form stops moving: the page's list of controls has not changed for `quietMs`, at most
   * `maxMs` in all. A résumé that was just attached is read by the page, which fills and moves fields for a
   * moment; a click placed while it does lands where a field was. Says how long it waited.
   */
  async settle(
    cdp: Cdp,
    sleep: (ms: number) => Promise<void>,
    quietMs: number,
    maxMs: number,
  ): Promise<number> {
    const started = Date.now();
    let changedAt = started;
    while (Date.now() - started < maxMs) {
      if (await this.read(cdp, { fresh: true })) changedAt = Date.now();
      if (Date.now() - changedAt >= quietMs) break;
      await sleep(FORM_SETTLE_POLL_MS);
    }
    return Date.now() - started;
  }

  /**
   * Reads the list from the page. `fresh` has the page collect it first, for a read that must see what
   * the last action did. Returns whether the list changed.
   */
  async read(cdp: Cdp, options: { fresh?: boolean } = {}): Promise<boolean> {
    try {
      const value = await ask(cdp, () =>
        controlMarkReadScript(this.version, options.fresh === true),
      );
      if (!value || typeof value !== "object") return false;
      const { version, marks } = value as { version?: unknown; marks?: unknown };
      if (typeof version !== "number" || marks === undefined) return false;
      const list = parseMarks(marks);
      if (!list) return false;
      const changed = !sameMarks(list, this.marks);
      this.version = version;
      this.marks = list;
      return changed;
    } catch {
      return false;
    }
  }

  /**
   * Where the form moved since the agent was last told of the list, to `now` (the latest list unless one is
   * given). Null when nothing is known (no list yet), empty when nothing moved.
   */
  moves(now: ControlMark[] = this.marks): LayoutMove[] | null {
    return layoutMoves(this.told, now);
  }

  /** The agent has been told of this list: the next move is measured from it. */
  commit(list: ControlMark[]): void {
    this.told = list;
  }

  /** The look that carried this list was a survey: the plan made on it measures its points on this page. */
  survey(list: ControlMark[]): void {
    this.surveyed = list;
  }

  /**
   * How far a place on the page as the last survey saw it (`y`, CSS pixels) has moved since, with the form:
   * 0 when nothing above it moved, null when it lies where something appeared or went, or when no survey
   * has been taken (nothing is known).
   */
  shiftSince(y: number): number | null {
    const moves = layoutMoves(this.surveyed, this.marks);
    return moves ? shiftAt(moves, y) : null;
  }

  /**
   * How far the control a point was bound to has moved since the point was planned (a reference in the
   * screenshot's pixels, `scale` of them to a CSS pixel); null when the control cannot be told.
   */
  async move(cdp: Cdp, ref: AgentMarkRef, scale: number): Promise<MarkMove | null> {
    try {
      const now = await ask(cdp, () => controlMarkWhereScript(ref.id));
      if (!isBox(now)) return null;
      return markMove(
        { x: ref.x / scale, y: ref.y / scale, w: ref.w / scale, h: ref.h / scale },
        now,
      );
    } catch {
      return null;
    }
  }

  /** Whether the point (CSS pixels in the window) is on the field of the control a point was bound to. */
  async holds(cdp: Cdp, ref: AgentMarkRef, x: number, y: number): Promise<boolean> {
    try {
      return (await ask(cdp, () => controlMarkHoldsScript(ref.id, x, y))) === true;
    } catch {
      return false;
    }
  }
}
