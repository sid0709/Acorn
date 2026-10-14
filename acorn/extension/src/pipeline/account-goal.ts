/**
 * Which account step the run tries next on a site. The order is a fixed
 * mechanism; what feeds it is evidence the decision model reads from the pages:
 * which account steps the site offers, and how the site answered each step the
 * run sent. Nothing here reads the page or matches its wording.
 *
 * Order: sign in first. When signing in is refused, create the account if the
 * site offers that, then sign in again; when it does not, or that sign-in is
 * refused too, reset the password, then sign in. A site that answered the
 * email-first step with a create form has no account yet: create comes first
 * there. Nothing is left once a sign-in after a completed reset is refused, or
 * the reset itself is refused.
 */

import { ACCOUNT_MODE, type AccountAttempt, type AccountMode } from "@acorn/shared/run-types";

/** The account steps the run can set out to do. */
export const ACCOUNT_GOALS: readonly AccountMode[] = [
  ACCOUNT_MODE.signIn,
  ACCOUNT_MODE.createAccount,
  ACCOUNT_MODE.resetPassword,
];

/** How a site answered the email-first step: the account exists, or it is new. */
export const IDENTIFIED = {
  existing: "existing",
  new: "new",
} as const;

export type Identified = (typeof IDENTIFIED)[keyof typeof IDENTIFIED];

/** What the run learned about one site's account, apart from the steps it sent. */
export interface SiteAccountEvidence {
  /**
   * Account steps any account page of this site offered (its form, or a control
   * that opens it); null until a read reported offers.
   */
  offers: AccountMode[] | null;
  /** The site's answer to the email-first step; null when none was sent. */
  identified: Identified | null;
  /** The run already took this site's way to go on without an account. */
  guestTaken: boolean;
  /** The run itself opened an account form here: its account work has started. */
  opened: boolean;
}

/** The page being worked: the account form it shows and the steps it offers (null: unknown). */
export interface AccountPage {
  mode: AccountMode | null;
  offers: AccountMode[] | null;
}

export function emptyAccountEvidence(): SiteAccountEvidence {
  return { offers: null, identified: null, guestTaken: false, opened: false };
}

/** Add what one page offered to what the site offered before. */
export function withOffers(
  evidence: SiteAccountEvidence,
  offers: readonly AccountMode[] | null | undefined,
): SiteAccountEvidence {
  if (!offers) return evidence;
  const known = new Set([...(evidence.offers ?? []), ...offers]);
  return { ...evidence, offers: ACCOUNT_GOALS.filter((goal) => known.has(goal)) };
}

/** What the site answered the email-first step with: the account form it showed next. */
export function identifiedBy(mode: AccountMode | null): Identified | null {
  if (mode === ACCOUNT_MODE.signIn) return IDENTIFIED.existing;
  if (mode === ACCOUNT_MODE.createAccount) return IDENTIFIED.new;
  return null;
}

/**
 * The next account step to try on this site, or null when nothing is left.
 * `attempts` are the steps the run sent here, oldest first, with how the site
 * answered each.
 */
export function nextAccountGoal(
  attempts: readonly AccountAttempt[],
  evidence: SiteAccountEvidence,
  page: AccountPage,
): AccountMode | null {
  const last = attempts.at(-1);
  // The site took a sign-in and asks for its next part (a password after the email).
  if (last?.accepted && last.mode === ACCOUNT_MODE.signIn) return ACCOUNT_MODE.signIn;
  // The emailed reset link opened the form that saves the new password.
  if (
    last?.accepted &&
    last.mode === ACCOUNT_MODE.resetPassword &&
    page.mode === ACCOUNT_MODE.resetPassword
  ) {
    return ACCOUNT_MODE.resetPassword;
  }
  const resetAt = lastIndexWhere(
    attempts,
    (attempt) => attempt.accepted && attempt.mode === ACCOUNT_MODE.resetPassword,
  );
  if (resetAt >= 0) {
    return refusedSince(attempts, resetAt, ACCOUNT_MODE.signIn) ? null : ACCOUNT_MODE.signIn;
  }
  if (attempts.some((a) => a.mode === ACCOUNT_MODE.resetPassword && !a.accepted)) return null;

  // The first due step the site offers (on this page or an earlier one); when it
  // offers none of them, the first due step: the control that leads toward it is
  // picked, or the run goes back to the posting.
  const due = dueGoals(attempts, evidence, page);
  const siteOffers = offeredBySite(evidence, page);
  return due.find((goal) => siteOffers === null || siteOffers.has(goal)) ?? due[0] ?? null;
}

/** The steps still worth trying, in order, before any reset was taken. */
function dueGoals(
  attempts: readonly AccountAttempt[],
  evidence: SiteAccountEvidence,
  page: AccountPage,
): AccountMode[] {
  const createdAt = lastIndexWhere(
    attempts,
    (attempt) => attempt.accepted && attempt.mode === ACCOUNT_MODE.createAccount,
  );
  const signInRefused = refusedSince(attempts, createdAt, ACCOUNT_MODE.signIn);
  const createTried = attempts.some((attempt) => attempt.mode === ACCOUNT_MODE.createAccount);
  const createFirst = evidence.identified === IDENTIFIED.new && !createTried;
  const siteOffers = offeredBySite(evidence, page);

  const due: AccountMode[] = [];
  if (!signInRefused && !createFirst) due.push(ACCOUNT_MODE.signIn);
  if (
    !createTried &&
    evidence.identified !== IDENTIFIED.existing &&
    (siteOffers === null || siteOffers.has(ACCOUNT_MODE.createAccount))
  ) {
    due.push(ACCOUNT_MODE.createAccount);
  }
  if (signInRefused) due.push(ACCOUNT_MODE.resetPassword);
  return due;
}

/** The steps this page offers, its own form included; null when the read reported none. */
function offeredOn(page: AccountPage): Set<AccountMode> | null {
  if (!page.offers) return null;
  return new Set(page.mode ? [...page.offers, page.mode] : page.offers);
}

/** The steps this site offered on any page so far; null when no read reported offers. */
function offeredBySite(evidence: SiteAccountEvidence, page: AccountPage): Set<AccountMode> | null {
  const onPage = offeredOn(page);
  if (!evidence.offers && !onPage) return null;
  return new Set([...(evidence.offers ?? []), ...(onPage ?? [])]);
}

/** A `mode` attempt the site refused after index `since` (-1: ever). */
function refusedSince(
  attempts: readonly AccountAttempt[],
  since: number,
  mode: AccountMode,
): boolean {
  return attempts.slice(since + 1).some((attempt) => attempt.mode === mode && !attempt.accepted);
}

/**
 * Whether the run fills the account form the page shows while it works on `goal`:
 * the goal's own form, or a step every goal goes through (only the account's
 * email, asked first). Any other form is left alone; its control opens the goal's.
 */
export function fillsAccountForm(goal: AccountMode, pageMode: AccountMode): boolean {
  return pageMode === goal || pageMode === ACCOUNT_MODE.identify;
}

/**
 * Whether an account step the page shows needs the profile's default password. An
 * email-first step asks for the email alone: it is sent without one, and the form
 * that follows asks for a password when the site has one (some sites only email a code).
 */
export function needsAccountPassword(pageMode: AccountMode): boolean {
  return pageMode !== ACCOUNT_MODE.identify;
}

/**
 * Whether the control a read named as the way on without an account is one. The
 * same control as the one that moves the page forward, on a page with fields of
 * its own, sends that page's form (an email-first step): it is the account step's
 * own control, and the page is filled before it is pressed. Ids are the read's.
 */
export function isGuestPath(args: {
  guestControl: number;
  forwardControl: number | null;
  pageFields: number;
}): boolean {
  return args.guestControl !== args.forwardControl || args.pageFields === 0;
}

/** The account steps the run sent on a site, each once, in the order first tried. */
export function triedGoals(attempts: readonly AccountAttempt[]): AccountMode[] {
  return [...new Set(attempts.map((attempt) => attempt.mode))];
}

function lastIndexWhere<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (test(items[i])) return i;
  }
  return -1;
}
