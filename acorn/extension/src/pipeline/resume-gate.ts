/** Why a run stopped before touching the page: no résumé to apply with. */
export const RESUME_NOT_CHOSEN = "No résumé was chosen for this job";

export type ResumeGate = { ok: true } | { ok: false; reason: string };

/**
 * Whether a run may act on the page: only with a résumé chosen for this job. The
 * recommend's own error says why none was chosen when it failed.
 */
export function resumeGate(hasResume: boolean, recommendError?: string | null): ResumeGate {
  if (hasResume) return { ok: true };
  return { ok: false, reason: recommendError?.trim() || RESUME_NOT_CHOSEN };
}
