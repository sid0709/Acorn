export const OAK_SESSIONS_COLLECTION = 'oak_sessions';

export const OAK_SOCKET_PATH = '/oak';

export const OAK_RUNTIME_FILE_KEY =
  process.env.OAK_RUNTIME_FILE_KEY?.trim() || 'runtime_file';

/** Attached on resume_upload: generated Worker-pool file if present, else Library recommend. */
export const OAK_RECOMMENDED_RESUME_KEY = 'recommended_resume';

/** Attached on Custom-tab resume_upload: editor-generated DOCX for a remembered tab. */
export const OAK_CUSTOM_RESUME_KEY = 'custom_resume';

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

/** Custom generate JD extract; posting prose plus a short reason. */
export function oakExtractJdMaxOutputTokens(): number {
  const n = Number.parseInt(
    String(process.env.OAK_EXTRACT_JD_MAX_OUTPUT_TOKENS || '6000'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 6000;
}

export function oakExtractJdTimeoutMs(): number {
  const n = Number.parseInt(
    String(process.env.OAK_EXTRACT_JD_TIMEOUT_MS || '25000'),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 25000;
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

export function oakRuntimeFilePath(): string | null {
  const raw = process.env.OAK_RUNTIME_FILE_PATH?.trim();
  return raw || null;
}

export function oakSessionTtlSeconds(): number {
  const DEFAULT = 12 * 60 * 60;
  const MIN = 5 * 60;
  const MAX = 7 * 24 * 60 * 60;
  const configured = Number.parseInt(
    String(process.env.OAK_SESSION_TTL_SECONDS || ''),
    10,
  );
  if (!Number.isFinite(configured)) return DEFAULT;
  return Math.min(MAX, Math.max(MIN, configured));
}
