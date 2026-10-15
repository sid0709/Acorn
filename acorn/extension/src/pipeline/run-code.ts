import type { FieldIssueScan } from "@acorn/shared/field-issues";

/**
 * Which fields took an emailed code, and whether the page refused them. A page that
 * flags something after the code was typed has refused the code only when it flags a
 * box the code went into; a flag on any other field (an unchecked consent, a missing
 * answer) is that field's, and a refill can fix it.
 */

const labelKey = (label: string | null | undefined) =>
  (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The labels of the fill steps that typed the code (the whole code, or one character of it). */
export function codeLabelsOf(
  actions: ReadonlyArray<{ action: string; value?: string | null; expected_label?: string | null }>,
  code: string,
): string[] {
  const labels = new Set<string>();
  for (const step of actions) {
    const value = step.value ?? "";
    if (step.action !== "fill" || !value) continue;
    if (value === code || (value.length === 1 && code.includes(value))) {
      labels.add(labelKey(step.expected_label));
    }
  }
  labels.delete("");
  return [...labels];
}

/**
 * Whether the page refused the code. With no record of the code's boxes the answer is
 * yes, as it was before the boxes were recorded: any flag after the code counts.
 */
export function codeRefused(
  codeLabels: readonly string[] | undefined,
  scan: FieldIssueScan,
): boolean {
  if (!codeLabels?.length) return true;
  const boxes = new Set(codeLabels);
  return scan.issues.some(
    (issue) =>
      boxes.has(labelKey(issue.label)) &&
      (issue.invalid || (issue.required && !issue.value.trim())),
  );
}
