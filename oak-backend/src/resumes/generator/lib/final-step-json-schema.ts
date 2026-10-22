import type { ChatCompletionInput } from '../../../ai/openai/openai.types';
import { cleanString } from './clean-string';

function parseSchema(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Structured-output schema for a final generation step, when the plan has one. */
export function finalStepJsonSchema(
  step: Record<string, unknown>,
): ChatCompletionInput['jsonSchema'] | undefined {
  if (step.kind !== 'final') return undefined;
  const schema = parseSchema(step.schema);
  if (!schema) return undefined;
  const name =
    cleanString(step.purpose).replace(/[^a-zA-Z0-9_-]/g, '_') || 'section';
  return { name, schema, strict: false };
}
