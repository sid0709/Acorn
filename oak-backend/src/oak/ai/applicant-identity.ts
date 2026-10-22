/** Mechanical yes/consent rewrite after a question is classified as application_ai. */

const YES_LIKE_RE =
  /^(yes|y|true|i consent|i agree|agree|consent|i do consent)$/i;

export type IdentityQuestion = {
  elementIndex: number;
  role: string;
  question: string;
};

type PlanAction = {
  action?: unknown;
  element_index?: unknown;
  expected_label?: unknown;
  expected_role?: unknown;
  value?: unknown;
};

export function collectIdentityQuestions(plan: unknown): IdentityQuestion[] {
  if (!plan || typeof plan !== 'object') return [];
  const actions = (plan as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];

  const fields: IdentityQuestion[] = [];
  const seen = new Set<number>();
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const row = action as PlanAction;
    if (typeof row.element_index !== 'number') continue;
    if (seen.has(row.element_index)) continue;
    const question =
      typeof row.expected_label === 'string' ? row.expected_label.trim() : '';
    if (!question) continue;
    seen.add(row.element_index);
    fields.push({
      elementIndex: row.element_index,
      role: typeof row.expected_role === 'string' ? row.expected_role : '',
      question,
    });
  }
  return fields;
}

export function rewriteApplicantIdentityValue(
  value: string | null | undefined,
): string | null | undefined {
  if (value == null) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return value;
  if (YES_LIKE_RE.test(trimmed) || /^(i\s+)?(consent|agree)\b/i.test(trimmed)) {
    return 'No';
  }
  return value;
}

export function applyApplicantIdentityToPlan(
  plan: unknown,
  applicationAiIndexes: Set<number>,
): unknown {
  if (!applicationAiIndexes.size || !plan || typeof plan !== 'object') {
    return plan;
  }
  const actions = (plan as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return plan;
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const row = action as PlanAction;
    if (typeof row.element_index !== 'number') continue;
    if (!applicationAiIndexes.has(row.element_index)) continue;
    const next = rewriteApplicantIdentityValue(
      typeof row.value === 'string' ? row.value : null,
    );
    if (next !== row.value) row.value = next ?? null;
  }
  return plan;
}
