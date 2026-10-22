/** Non-admin Fill needs a Worker-pool résumé, a Custom generated or Library résumé, or a remembered Custom tab. */
export function oakFillResumeSatisfied(input: {
  isAdmin: boolean;
  jobResumeAvailable: boolean;
  customResumeAvailable: boolean;
  customRemembered?: boolean;
}): boolean {
  return (
    input.isAdmin ||
    input.jobResumeAvailable ||
    input.customResumeAvailable ||
    Boolean(input.customRemembered)
  );
}
