/** Env-backed knobs for the chat client. */

function envInt(name: string, fallback: number, min = 1, max = 256): number {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(max, Math.floor(n));
}

export const LLM_CHAT_TIMEOUT_MS = envInt(
  'LLM_CHAT_TIMEOUT_MS',
  90_000,
  5_000,
  300_000,
);
export const LLM_CHAT_RETRIES = envInt('LLM_CHAT_RETRIES', 3, 0, 8);
