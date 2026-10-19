/**
 * The limits of the quick text pass. They bound what one pass reads from a page and what it asks of
 * the server, so a long page stays one request.
 */

import { AGENT_PREFILL } from "../settings";

/**
 * Whether a run makes the pass: what the caller asked for, else the build's setting (AGENT_PREFILL).
 */
export function prefillEnabled(requested?: boolean): boolean {
  return requested ?? AGENT_PREFILL;
}

/** Fewer empty fields than this are left to the model's own look: a sign-in page is not worth a call. */
export const PREFILL_MIN_FIELDS = 3;
/**
 * The longest page, in characters of the serialized tree, that is sent. A longer one is cut at a line.
 * The server's limit (maxPrefillTreeChars) is higher.
 */
export const PREFILL_TREE_MAX_CHARS = 240_000;
/** The longest label, question, or option that is read from the page. */
export const PREFILL_LABEL_MAX_CHARS = 160;
/** How long a frame gets to answer one question about its page. */
export const PREFILL_FRAME_TIMEOUT_MS = 8_000;
/** The wait after scrolling an element into view, so the page and its frames have settled. */
export const PREFILL_REVEAL_MS = 120;
/** The wait between asking a parent frame where its child sits, and reading the answer. */
export const PREFILL_PROBE_WAIT_MS = 40;
/** How many times a parent frame is read for a child's probe before the field is left alone. */
export const PREFILL_PROBE_READS = 5;
/** The most child frames a parent remembers probes of at once. */
export const PREFILL_PROBE_MAX = 64;
/** The wait after typing into a field, so the page's own handlers settle before it is read back. */
export const PREFILL_SETTLE_MS = 80;
/** How long a list the page draws is given to open before its options are read. */
export const PREFILL_LIST_OPEN_MS = 450;
/** How long a pass waits for the server's answer; the server stops its own calls a little later. */
export const PREFILL_TIMEOUT_MS = 90_000;
/** The longest one field may take (find it, click it, type, read it back) before the pass goes on without it. */
export const PREFILL_FILL_TIMEOUT_MS = 25_000;
/** The longest the whole pass may type; fields it did not reach are left to the model's look. */
export const PREFILL_TOTAL_TIMEOUT_MS = 120_000;
/** What a field that holds the account password is reported as: the password itself is never shown or logged. */
export const PREFILL_SECRET_SHOWN = "(hidden)";
/** What the overlay's bar says while the pass types. */
export const PREFILL_OVERLAY_LABEL = "Acorn is filling the plain fields";

/** After a review that says the page is still loading: the most times in a row it is looked at again, and the wait between. */
export const REVIEW_LOADING_WAITS = 4;
export const REVIEW_LOADING_WAIT_MS = 1_000;
/** A control pressed this many times with the page not moving on is left to the model's own look. */
export const ADVANCE_STUCK_TRIES = 2;
/**
 * Whether a page whose own state is clean (or that has no fields) is moved on at once, with no review of
 * the whole page first. The review runs when a press did not move the page.
 */
export const DOM_OPTIMISTIC_ADVANCE = true;
/** After pressing a control: how long the tab gets to finish loading, how often it is asked, and the beat before the first ask. */
export const ADVANCE_LOAD_MAX_MS = 8_000;
export const ADVANCE_LOAD_POLL_MS = 150;
export const ADVANCE_NAVIGATION_BEAT_MS = 300;
/** How long after a press a navigation has to start (the address changes, or the tab says it is loading) before the press is taken as having stayed on the page. */
export const ADVANCE_NAVIGATION_APPEAR_MS = 1_500;
/** Told to the model when no control was chosen with enough certainty to press: the one that continues may simply be out of sight. */
export const ADVANCE_UNSURE_NOTE =
  "Acorn could not tell which control continues the application from the part of the page it could see. It may be below the visible part: scroll to find it.";
/**
 * A control that continues is greyed out for the moment a page takes to submit after it was pressed. A
 * page that shows one is read again after this long, and the control is reported only if it is still
 * disabled.
 */
export const REVIEW_BLOCKED_RECHECK_MS = 1_200;
/** What the overlay's bar says while the page is reviewed, and while its next control is pressed. */
export const REVIEW_OVERLAY_LABEL = "Acorn is reviewing the page";
export const ADVANCE_OVERLAY_LABEL = "Acorn is continuing to the next step";
