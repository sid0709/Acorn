/**
 * Which account step the run tries next on a site, decided by a fixed order and
 * that site's own history of attempts. Nothing here reads the page: the decision
 * model only says what form the page shows and which control does the goal.
 *
 * Order: create an account first. Then sign in, whether the site took the new
 * account or refused it (it may already exist, and a site can answer either way
 * without saying so). When signing in is refused, reset the password, then sign in
 * again. Only a sign-in refused after a completed reset, or a refused reset, ends
 * the order: then nothing is left to try.
 */

import { ACCOUNT_MODE, type AccountAttempt, type AccountMode } from "@acorn/shared/run-types";

/**
 * The next account step to try on this site, or null when nothing is left.
 * `pageMode` is the form the page shows now (from the last read): a reset the site
 * just took, followed by another reset form, is the reset's next part (the email
 * asks for the reset; the link opens the form that sets the new password).
 */
export function nextAccountGoal(
  attempts: readonly AccountAttempt[],
  pageMode: AccountMode | null,
): AccountMode | null {
  const tried = (mode: AccountMode, accepted?: boolean) =>
    attempts.some(
      (attempt) => attempt.mode === mode && (accepted == null || attempt.accepted === accepted),
    );
  const last = attempts.at(-1);
  if (last?.accepted && last.mode === ACCOUNT_MODE.signIn) return ACCOUNT_MODE.signIn;
  if (
    last?.accepted &&
    last.mode === ACCOUNT_MODE.resetPassword &&
    pageMode === ACCOUNT_MODE.resetPassword
  ) {
    return ACCOUNT_MODE.resetPassword;
  }

  const resetAt = lastIndexWhere(
    attempts,
    (attempt) => attempt.accepted && attempt.mode === ACCOUNT_MODE.resetPassword,
  );
  if (resetAt >= 0) {
    const refusedSince = attempts
      .slice(resetAt + 1)
      .some((attempt) => attempt.mode === ACCOUNT_MODE.signIn && !attempt.accepted);
    return refusedSince ? null : ACCOUNT_MODE.signIn;
  }
  if (tried(ACCOUNT_MODE.resetPassword, false)) return null;
  if (!tried(ACCOUNT_MODE.createAccount)) return ACCOUNT_MODE.createAccount;
  if (!tried(ACCOUNT_MODE.signIn, false)) return ACCOUNT_MODE.signIn;
  return ACCOUNT_MODE.resetPassword;
}

function lastIndexWhere<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (test(items[i])) return i;
  }
  return -1;
}
