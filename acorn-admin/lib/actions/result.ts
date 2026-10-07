/**
 * What a server action returns. Errors come back as values: a thrown error's
 * message is hidden from the browser in production builds.
 */
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function toResult<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The value, or a thrown Error with the action's message (for client callers). */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
