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
/** A probe is a single DOM pass; a frame that takes longer is treated as having moved. */
export const RUN_PROBE_TIMEOUT_MS = 2_000;
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
