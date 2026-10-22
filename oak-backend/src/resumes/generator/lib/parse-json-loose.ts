/** Best-effort JSON parse for model responses (fenced or embedded object). */
export function parseJsonLoose(text: unknown): unknown {
  const raw = String(text ?? '').trim();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    /* fall through */
  }
  const fenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(fenced) as unknown;
  } catch {
    /* fall through */
  }
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return JSON.parse(fenced.slice(first, last + 1)) as unknown;
  }
  throw new Error('No JSON object found in model response.');
}
