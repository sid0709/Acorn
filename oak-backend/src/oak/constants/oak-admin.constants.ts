/** Protocol — non-admin Fill requires a generated or recommended resume. */
export const OAK_FILL_RESUME_REQUIRED_CODE =
  'OAK_FILL_RESUME_REQUIRED' as const;

export const OAK_FILL_RESUME_REQUIRED_MESSAGE =
  'Fill without a recommended resume is an admin privilege';

/**
 * Keep-probability for each non-admin plan action.
 * 0.8 ≈ 80% run, 20% skip (`Math.random() < temperature`).
 */
export const OAK_NON_ADMIN_ACTION_TEMPERATURE = 0.8;

/** Listed on temperature-skipped steps in unresolved_items. */
export const OAK_NON_ADMIN_TEMPERATURE_STEP_SKIPPED =
  'Skipped by action temperature (non-admin plan)';
