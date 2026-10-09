/** Limits for the Run orchestrator. Every loop in a run is bounded by one of these. */

/** Refill rounds one page gets before the run stops and reports why. */
export const RUN_MAX_REFILLS_PER_PAGE = 3;
/**
 * Clicks that could not land (the page re-rendered and the control's node is gone)
 * in a row; each one is followed by a fresh read before the run stops.
 */
export const RUN_MAX_CLICK_RETRIES = 2;
/**
 * Passes over what a page still needs when it holds its forward control disabled
 * (fields left blank, boxes left off), each followed by another click.
 */
export const RUN_MAX_BLOCKED_PASSES = 2;
/** Fills of one step, of any kind (full, refill, pending pass), before the run stops. */
export const RUN_MAX_FILLS_PER_PAGE = 5;
/** Model calls one run may make across all its pages before it stops. */
export const RUN_MAX_AI_CALLS = 200;
/** Clicks on a page that change nothing and flag nothing before the run stops. */
export const RUN_MAX_NO_EFFECT = 2;
/** Orchestrator iterations in one run; a page takes a few. */
export const RUN_MAX_STEPS = 60;
/** Pages one run moves through. */
export const RUN_MAX_PAGES = 25;

/** A click is given this long to change the page before it counts as having done nothing. */
export const RUN_SETTLE_UNCHANGED_MS = 5_000;
/** The hard cap on waiting for a click's navigation, new tab, or page load. */
export const RUN_SETTLE_MAX_MS = 20_000;
/** First look at the page after a click waits this long, so a navigation can begin. */
export const RUN_SETTLE_MIN_MS = 1_200;
/** How often a click's effect is checked. */
export const RUN_SETTLE_POLL_MS = 400;
/** How long the run waits for the applicant to do a step only they can (a code sent to them). */
export const RUN_PERSON_WAIT_MAX_MS = 10 * 60_000;
/** How often the run looks whether the applicant has moved the page on. */
export const RUN_PERSON_POLL_MS = 1_500;
/**
 * How often the run looks at the applicant's newest emails for a code or link a
 * site sent. A look whose emails did not change costs no model call.
 */
export const RUN_MAIL_POLL_MS = 5_000;
/** How long the run waits for that email to arrive before it stops; mail can be slow. */
export const RUN_MAIL_WAIT_MAX_MS = 5 * 60_000;
/**
 * Times one run goes back to the posting it started from, after an account step
 * (an emailed link, a password reset) leaves it on a page with no way forward.
 */
export const RUN_MAX_RETURNS_TO_START = 2;
/**
 * A forward control found disabled within this long of its own click that landed
 * is the page still working on that click (saving, submitting), not a page that
 * needs more answers.
 */
export const RUN_BUSY_AFTER_CLICK_MS = 30_000;
/** How long the run lets a busy page work before it looks again. */
export const RUN_BUSY_WAIT_MS = 3_000;
/**
 * Passes over what is still blank that one step gets when the page answers a
 * click with an alert of its own but marks no field.
 */
export const RUN_MAX_ALERT_PASSES = 1;
/** Busy looks one step gets before a disabled control is treated as blocked. */
export const RUN_MAX_BUSY_WAITS = 5;
/** New page lines one page read hands the decision model, newest answer first in line. */
export const RUN_NEW_TEXT_LINES_MAX = 20;
/** Codes or links one run takes from the applicant's mail before it stops. */
export const RUN_MAX_MAIL_VERIFICATIONS = 4;
/** Page messages kept with a rejected account step, for the next decision. */
export const RUN_ACCOUNT_MESSAGES_MAX = 3;
/** Account steps one run may send in all. */
export const RUN_MAX_ACCOUNT_ATTEMPTS = 8;
/** A probe is a single DOM pass; a frame that takes longer is treated as having moved. */
export const RUN_PROBE_TIMEOUT_MS = 2_000;
/** A page counts as settled once its probe stays the same this long (an app done rendering). */
export const RUN_PAGE_QUIET_MS = 1_500;
/** The most the run waits for a loaded page to settle before reading it anyway. */
export const RUN_PAGE_SETTLE_MAX_MS = 15_000;
/** Fresh looks at a page that read as not an application or blocked, before the run stops. */
export const RUN_UNCLEAR_REREADS = 3;
/** The wait before each of those looks. */
export const RUN_UNCLEAR_WAIT_MS = 3_000;
/**
 * How long a page that still shows it is loading (a slow site: a spinner, a busy
 * region, a document not done) is waited for, past the looks above.
 */
export const RUN_SLOW_PAGE_MAX_MS = 90_000;
/**
 * How long a page read keeps trying while the page loads or its content script is
 * not ready yet (a slow network, a page drawn after a redirect).
 */
export const RUN_PAGE_READ_PATIENCE_MS = 30_000;
/** The wait between those tries. */
export const RUN_PAGE_READ_RETRY_MS = 2_000;
/** A tab that has not finished loading by this point is read anyway. */
export const RUN_TAB_LOAD_MAX_MS = 20_000;

/** Visible page copy sent with a decision. The backend reads less; this bounds the request. */
export const RUN_PAGE_TEXT_MAX_CHARS = 8_000;
/** Longest evidence line sent with a failure diagnosis. */
export const RUN_EVIDENCE_LINE_MAX_CHARS = 200;
/** Evidence lines sent with a failure diagnosis. */
export const RUN_EVIDENCE_MAX_LINES = 20;
/** Embedded frames listed with a page snapshot. */
export const RUN_FRAMES_MAX = 6;

/** Run log events per request to the backend. */
export const RUN_LOG_BATCH_MAX = 50;
/** Events wait this long for company before they are sent. */
export const RUN_LOG_FLUSH_MS = 300;
