/**
 * One request at a time to the agent over the person's line. Two uploads at once share the line and both
 * arrive later; a step sent after the zone photo in flight arrives sooner than one sent beside it, and the
 * photo it would otherwise carry again is already there. Urgent work, which an action or the whole run
 * waits on (a step, a locate, a dropdown's picture), goes before background work (zone photos, a survey's
 * screens sent ahead). Whatever is in flight finishes first: nothing is cut off.
 */

export type LanePriority = "urgent" | "background";

export class UploadLane {
  private busy = false;
  private readonly urgent: (() => void)[] = [];
  private readonly background: (() => void)[] = [];

  /** Runs work when the line is free, urgent work first. The promise is the work's own. */
  run<T>(priority: LanePriority, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.busy = true;
        Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            this.busy = false;
            this.next();
          });
      };
      if (!this.busy) start();
      else (priority === "urgent" ? this.urgent : this.background).push(start);
    });
  }

  /** How many requests are in flight or waiting. */
  get pending(): number {
    return this.urgent.length + this.background.length + (this.busy ? 1 : 0);
  }

  private next(): void {
    const start = this.urgent.shift() ?? this.background.shift();
    start?.();
  }
}
