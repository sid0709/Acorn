/** A stand-in protocol session for tests: records every command and answers from a table. */

import type { Cdp } from "./cdp";

export type SentCommand = { method: string; params?: Record<string, unknown> };

export type FakeCdp = Cdp & {
  sent: SentCommand[];
  /** Delivers a protocol event to the session's listeners. */
  emit(method: string, params?: Record<string, unknown>): void;
  /** Delivers a detach to the session's listeners. */
  detached(reason: string): void;
  /** The commands of one method, in order. */
  of(method: string): SentCommand[];
};

/**
 * `answers` maps a method to its result, or to a function that computes it from the
 * parameters and may throw. A method with no answer resolves with `{}`.
 */
export function fakeCdp(answers: Record<string, unknown> = {}): FakeCdp {
  const sent: SentCommand[] = [];
  const eventListeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  const detachListeners = new Set<(reason: string) => void>();
  return {
    sent,
    send<T>(method: string, params?: object) {
      sent.push({ method, params: params as Record<string, unknown> | undefined });
      try {
        const answer = answers[method];
        const value =
          typeof answer === "function" ? (answer as (p?: object) => unknown)(params) : answer;
        return Promise.resolve((value ?? {}) as T);
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onDetach(listener) {
      detachListeners.add(listener);
      return () => detachListeners.delete(listener);
    },
    async detach() {},
    emit(method, params = {}) {
      for (const listener of eventListeners) listener(method, params);
    },
    detached(reason) {
      for (const listener of detachListeners) listener(reason);
    },
    of: (method) => sent.filter((command) => command.method === method),
  };
}
