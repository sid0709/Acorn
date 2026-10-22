export const OAK_SOCKET_PATH = '/oak';

export const OAK_RUNTIME_FILE_KEY =
  process.env.OAK_RUNTIME_FILE_KEY?.trim() || 'runtime_file';

/** Attached on resume_upload: the Library résumé Fill uploads. */
export const OAK_RECOMMENDED_RESUME_KEY = 'recommended_resume';

export const OPENAI_RESPONSES_URL =
  process.env.OAK_OPENAI_API_URL?.trim() ||
  'https://api.openai.com/v1/responses';

export function oakMaxOutputTokens(): number {
  const n = Number.parseInt(
    String(process.env.OAK_MAX_OUTPUT_TOKENS || '12000'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 12000;
}

/** Option matching is a short JSON object; still needs headroom for reasoning models. */
export function oakMatchOptionMaxOutputTokens(): number {
  const n = Number.parseInt(
    String(process.env.OAK_MATCH_OPTION_MAX_OUTPUT_TOKENS || '2500'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 2500;
}

/** Batched typing-field rewrite; several short answers plus a few paragraphs. */
export function oakProseMaxOutputTokens(): number {
  const n = Number.parseInt(
    String(process.env.OAK_PROSE_MAX_OUTPUT_TOKENS || '6000'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 6000;
}

/** Fail open back to planner drafts if the writer exceeds this. */
export function oakProseTimeoutMs(): number {
  const n = Number.parseInt(
    String(process.env.OAK_PROSE_TIMEOUT_MS || '20000'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 20000;
}

/** Short JSON classify of question meaning (application vs workplace AI). */
export function oakIdentityMaxOutputTokens(): number {
  const n = Number.parseInt(
    String(process.env.OAK_IDENTITY_MAX_OUTPUT_TOKENS || '2500'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 2500;
}

export function oakIdentityTimeoutMs(): number {
  const n = Number.parseInt(
    String(process.env.OAK_IDENTITY_TIMEOUT_MS || '8000'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

/** Slightly warmer than the planner so typed answers sound less templated. */
export function oakProseTemperature(): number {
  const n = Number.parseFloat(
    String(process.env.OAK_PROSE_TEMPERATURE || '0.4'),
  );
  return Number.isFinite(n) ? n : 0.4;
}

export function oakTemperature(): number {
  const n = Number.parseFloat(
    String(process.env.OAK_OPENAI_TEMPERATURE || '0.1'),
  );
  return Number.isFinite(n) ? n : 0.1;
}

export function oakReasoningEffort(): string | null {
  const raw = process.env.OAK_OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  if (!raw) return null;
  const allowed = new Set([
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  return allowed.has(raw) ? raw : null;
}

/**
 * GPT-5 / GPT-6 / o-series Responses models reject custom `temperature`.
 * Use reasoning.effort instead (env override, else a safe default).
 */
export function oakModelRejectsTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  return (
    m.startsWith('gpt-5') ||
    m.startsWith('gpt-6') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  );
}

/** Reasoning effort to send when temperature is unsupported. */
export function oakReasoningEffortForModel(model: string): string | null {
  const configured = oakReasoningEffort();
  if (configured) return configured;
  if (oakModelRejectsTemperature(model)) return 'low';
  return null;
}

/** `acorn_ai_usage.feature` of each Oak model call. Q&A is Acorn's own "ask". */
export const OAK_USAGE_FEATURES = {
  analyze: 'oak_analyze',
  matchOption: 'oak_match_option',
  prose: 'oak_prose',
  identity: 'oak_identity',
  qa: 'ask',
} as const;
