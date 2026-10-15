/**
 * A plan names a field by its index in one read of the page; what it answers is a
 * question, and the field list says which group of options that question is. Putting
 * the group on each action lets the page side check a step answers the group the
 * plan meant, whatever its index turned into by the time the step runs.
 */

import type { FormField } from "../form-fields";
import type { PlanAction } from "./types";

/** The actions, each carrying the choice group of the field it targets (when it has one). */
export function annotateGroups<
  T extends Pick<PlanAction, "element_index"> & { expected_group?: string | null },
>(actions: T[] | null | undefined, fields: readonly FormField[] | null | undefined): void {
  if (!actions?.length || !fields?.length) return;
  const groups = new Map<number, string>();
  for (const field of fields) if (field.group) groups.set(field.elementIndex, field.group);
  for (const action of actions) {
    const group = action.element_index == null ? undefined : groups.get(action.element_index);
    if (group) action.expected_group = group;
  }
}
