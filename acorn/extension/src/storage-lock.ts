/**
 * One writer at a time per storage key. A per-tab map lives under one key, and
 * every update reads the whole map, changes its own row, and writes the map back.
 * With many tabs running at once, two updates that overlap make the later write
 * drop the earlier one's row (a résumé just recommended for a tab vanished this
 * way). Updates to the same key run in turn; different keys do not wait.
 */

const tails = new Map<string, Promise<unknown>>();

/** Run update after every earlier update of key has finished. */
export function withStorageLock<T>(key: string, update: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(update, update);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
