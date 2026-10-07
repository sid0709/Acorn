/**
 * Where a run's time goes: milliseconds summed per named phase. Phases may repeat
 * (one "click" per page); their time adds up. Logged with a run, never shown as UI.
 */
export class PhaseClock {
  private readonly totals: Record<string, number> = {};

  /** Run `work` and add its wall-clock time to `phase`, whether it succeeds or throws. */
  async time<T>(phase: string, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await work();
    } finally {
      this.add(phase, Date.now() - started);
    }
  }

  add(phase: string, ms: number): void {
    this.totals[phase] = (this.totals[phase] ?? 0) + Math.max(0, ms);
  }

  /** A copy of the totals, phases in the order they first ran. */
  summary(): Record<string, number> {
    return { ...this.totals };
  }
}
