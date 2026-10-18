/**
 * Deciding whether a pass is worth making on the page as it is now. A form that changes under the
 * same address (the next step of an application) shows new fields, and only those are new to the pass.
 */

import { PREFILL_MIN_FIELDS } from "./settings";

import type { TreeScan } from "./scan";

/** What one frame said of its fields. */
export interface FrameScan {
  frameId: number;
  scan: TreeScan;
}

/** What the gate decided, with how many new empty fields it saw (for the run's log). */
export type PrefillDecision =
  | { kind: "skip"; fresh: number }
  | { kind: "wait"; fresh: number }
  | { kind: "run"; frameId: number; fresh: string[] };

/**
 * Remembers which fields the pass has been asked about, so each is asked once, and which it has
 * seen, so a page that can fill itself from a résumé gets a look first.
 */
export class PrefillGate {
  private readonly attempted = new Set<string>();
  private readonly seen = new Set<string>();

  /**
   * `run` with the frame to send, `wait` to leave this look to the model, or `skip`. The frame is the one
   * with the most empty fields (the form's own frame, when it is embedded). A page that offers a file
   * input is left alone the first time its fields appear: the model uploads the résumé first, as it is
   * told to, and the page's own autofill would only overwrite what was typed.
   */
  assess(frames: FrameScan[]): PrefillDecision {
    let best: FrameScan | null = null;
    for (const frame of frames) {
      if (
        !best ||
        frame.scan.empty.length > best.scan.empty.length ||
        (frame.scan.empty.length === best.scan.empty.length && frame.frameId > best.frameId)
      ) {
        best = frame;
      }
    }
    if (!best) return { kind: "skip", fresh: 0 };
    const fresh = best.scan.empty.filter((field) => !this.attempted.has(field));
    if (fresh.length < PREFILL_MIN_FIELDS) return { kind: "skip", fresh: fresh.length };
    const firstSight = fresh.every((field) => !this.seen.has(field));
    for (const field of fresh) this.seen.add(field);
    if (best.scan.hasFile && firstSight) return { kind: "wait", fresh: fresh.length };
    return { kind: "run", frameId: best.frameId, fresh };
  }

  /** Marks fields as asked about, whatever came of it: a failing pass is not made again and again. */
  attempt(fresh: string[]): void {
    for (const field of fresh) this.attempted.add(field);
  }
}
