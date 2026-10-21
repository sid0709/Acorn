/**
 * What the person points at on the run's board, so the map, the list of questions and the filmstrip light
 * up the same thing: a question (a row of the list, or its marks on the map), or a picture of the filmstrip.
 */
export type RunFocus = { kind: "question"; id: string } | { kind: "shot"; index: number };

/** Whether two foci are the same, so pointing at what is already lit changes nothing. */
export function sameFocus(a: RunFocus | null, b: RunFocus | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "question" && b.kind === "question") return a.id === b.id;
  if (a.kind === "shot" && b.kind === "shot") return a.index === b.index;
  return false;
}
