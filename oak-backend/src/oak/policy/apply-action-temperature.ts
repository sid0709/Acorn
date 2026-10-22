import { OAK_NON_ADMIN_TEMPERATURE_STEP_SKIPPED } from '../constants/oak-admin.constants';

function isFileUploadAction(action: unknown): boolean {
  if (!action || typeof action !== 'object') return false;
  const kind = (action as { action?: unknown }).action;
  return kind === 'upload' || kind === 'resume_upload';
}

/** Uploads first, then remaining steps — matches Oak executionIndexOrder. */
export function executionIndexOrder(actions: unknown[]): number[] {
  const uploads: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < actions.length; i += 1) {
    if (isFileUploadAction(actions[i])) uploads.push(i);
    else rest.push(i);
  }
  return [...uploads, ...rest];
}

function actionSkipLabel(action: unknown): string {
  if (!action || typeof action !== 'object') {
    return OAK_NON_ADMIN_TEMPERATURE_STEP_SKIPPED;
  }
  const row = action as {
    action?: unknown;
    expected_label?: unknown;
    element_index?: unknown;
  };
  const kind = typeof row.action === 'string' ? row.action : 'action';
  const label =
    typeof row.expected_label === 'string' ? row.expected_label.trim() : '';
  const idx = typeof row.element_index === 'number' ? row.element_index : null;
  const target = label || (idx != null ? `element ${idx}` : kind);
  return `${OAK_NON_ADMIN_TEMPERATURE_STEP_SKIPPED}: ${kind} ${target}`;
}

function actionElementIndexes(action: unknown): number[] {
  if (!action || typeof action !== 'object') return [];
  const row = action as {
    element_index?: unknown;
    element_indexes?: unknown;
  };
  const out: number[] = [];
  if (typeof row.element_index === 'number') out.push(row.element_index);
  if (Array.isArray(row.element_indexes)) {
    for (const n of row.element_indexes) {
      if (typeof n === 'number') out.push(n);
    }
  }
  return out;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Keep each action with probability `temperature` (threshold vs Math.random).
 * Walks upload-first run order. Skipped steps go to unresolved_items.
 * forbidden_actions and stop_before_submit are unchanged.
 */
export function applyActionTemperature(
  plan: unknown,
  temperature: number,
  random: () => number = Math.random,
): unknown {
  if (!plan || typeof plan !== 'object') return plan;
  const p = plan as {
    actions?: unknown;
    unresolved_items?: unknown;
    validation?: unknown;
    forbidden_actions?: unknown;
  };
  if (!Array.isArray(p.actions)) return plan;

  const keepChance = clampUnit(temperature);
  const actions: unknown[] = p.actions;
  const order = executionIndexOrder(actions);
  const kept: unknown[] = [];
  const skippedLabels: string[] = [];
  for (const idx of order) {
    const action = actions[idx];
    if (random() < keepChance) kept.push(action);
    else skippedLabels.push(actionSkipLabel(action));
  }

  const prevUnresolved = Array.isArray(p.unresolved_items)
    ? p.unresolved_items.filter((item) => typeof item === 'string')
    : [];

  const keptIdx = new Set<number>();
  for (const action of kept) {
    for (const n of actionElementIndexes(action)) keptIdx.add(n);
  }

  const validation =
    p.validation && typeof p.validation === 'object'
      ? (p.validation as Record<string, unknown>)
      : null;
  const prevRequired = Array.isArray(validation?.required_element_indexes)
    ? validation.required_element_indexes
    : [];

  return {
    ...p,
    actions: kept,
    unresolved_items: [...prevUnresolved, ...skippedLabels],
    validation: validation
      ? {
          ...validation,
          required_element_indexes: prevRequired.filter(
            (n) => typeof n === 'number' && keptIdx.has(n),
          ),
        }
      : p.validation,
  };
}
