/** Trim string coercion used across resume-generator helpers. */
export function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}
