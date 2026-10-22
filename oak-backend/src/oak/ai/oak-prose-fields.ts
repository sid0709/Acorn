export type TypingFillField = {
  elementIndex: number;
  question: string;
  role: string;
  draft: string;
};

const TYPING_ROLES = new Set([
  'textbox',
  'textarea',
  'searchbox',
  'text',
  'input',
  'spinbutton',
]);

const CHOICE_ROLES = new Set([
  'combobox',
  'listbox',
  'select',
  'radio',
  'checkbox',
  'switch',
  'option',
  'menuitem',
  'button',
]);

type FillAction = {
  action?: unknown;
  element_index?: unknown;
  expected_label?: unknown;
  expected_role?: unknown;
  value?: unknown;
};

function roleToken(role: string): string {
  const token =
    role
      .trim()
      .toLowerCase()
      .split(/[\s,/|:]+/)[0] || '';
  return token.replace(/^role=/, '');
}

export function isTypingFillAction(action: unknown): boolean {
  if (!action || typeof action !== 'object') return false;
  const row = action as FillAction;
  if (row.action !== 'fill') return false;
  if (typeof row.element_index !== 'number') return false;
  if (typeof row.expected_role !== 'string') return false;
  const role = roleToken(row.expected_role);
  if (!role || CHOICE_ROLES.has(role)) return false;
  return TYPING_ROLES.has(role);
}

export function selectTypingFillActions(plan: unknown): TypingFillField[] {
  if (!plan || typeof plan !== 'object') return [];
  const actions = (plan as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];

  const fields: TypingFillField[] = [];
  const seen = new Set<number>();
  for (const action of actions) {
    if (!isTypingFillAction(action)) continue;
    const row = action as FillAction;
    const elementIndex = row.element_index as number;
    if (seen.has(elementIndex)) continue;
    seen.add(elementIndex);
    const label =
      typeof row.expected_label === 'string' ? row.expected_label.trim() : '';
    fields.push({
      elementIndex,
      question: label || `Field ${elementIndex}`,
      role: roleToken(String(row.expected_role)),
      draft: typeof row.value === 'string' ? row.value : '',
    });
  }
  return fields;
}

export function overlayTypingFillValues(
  plan: unknown,
  values: Map<number, string>,
): unknown {
  if (!values.size || !plan || typeof plan !== 'object') return plan;
  const actions = (plan as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return plan;

  for (const action of actions) {
    if (!isTypingFillAction(action)) continue;
    const row = action as FillAction;
    const next = values.get(row.element_index as number);
    if (typeof next === 'string' && next.trim()) row.value = next.trim();
  }
  return plan;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('Writer returned no JSON object');
}

export function parseProseAnswerMap(
  text: string,
  allowedIndexes?: Set<number>,
): Map<number, string> {
  const parsed = JSON.parse(extractJsonObject(text)) as {
    answers?: unknown;
  };
  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  const map = new Map<number, string>();
  for (const entry of answers) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { element_index?: unknown; value?: unknown };
    const index =
      typeof row.element_index === 'number'
        ? row.element_index
        : Number(row.element_index);
    if (!Number.isFinite(index) || typeof row.value !== 'string') continue;
    if (allowedIndexes && !allowedIndexes.has(index)) continue;
    const value = row.value.trim();
    if (value) map.set(index, value);
  }
  return map;
}
