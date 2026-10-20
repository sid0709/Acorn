/**
 * Timing for the run's log. A slow application is found by reading where each step's time went:
 * the look (capture, page reads), the request (server, network), each action and the waits in it.
 */

/** Milliseconds by phase name. */
export type Laps = Record<string, number>;

/** Times named parts of a piece of work in turn; a part timed twice adds up. */
export class Stopwatch {
  readonly startedAt = Date.now();
  readonly laps: Laps = {};

  /** Runs `work` and adds how long it took to the lap called `name`. */
  async time<T>(name: string, work: () => Promise<T>): Promise<T> {
    const began = Date.now();
    try {
      return await work();
    } finally {
      this.add(name, Date.now() - began);
    }
  }

  add(name: string, ms: number): void {
    this.laps[name] = (this.laps[name] ?? 0) + ms;
  }

  get ms(): number {
    return Date.now() - this.startedAt;
  }
}

/** One request to the agent server, as the log records it. */
export interface HttpTiming {
  method: string;
  /** The path, with the session id replaced by `:id`. */
  route: string;
  /** 0 when no answer came. */
  status: number;
  /** When the request began (unix ms). */
  startedAt: number;
  /** The whole request, answer read. */
  ms: number;
  /** From sending to the answer's headers arriving, and from there to its body being read. */
  headersMs: number;
  bodyMs: number;
  requestBytes: number;
  responseBytes: number;
  /** The server's own time (its `X-Agent-Handler-Ms`); absent when the server did not say. */
  serverMs?: number;
  /** The rest of the request: sending it, the wire both ways and reading the answer. */
  networkMs?: number;
  /** The server's clock minus ours, to within the network's delay: a large figure explains odd order. */
  clockSkewMs?: number;
  /** A failure's code (`timeout`, `unreachable`, or the server's own). */
  error?: string;
}

/** Where a request's time went: what the log's `agent-step` carries beside the request itself. */
export function httpSummary(timing: HttpTiming | undefined): Partial<HttpTiming> {
  if (!timing) return {};
  const { serverMs, networkMs, requestBytes, responseBytes, headersMs, bodyMs } = timing;
  return { serverMs, networkMs, requestBytes, responseBytes, headersMs, bodyMs };
}
