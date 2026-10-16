/**
 * What the run shows of its look in Gmail for a code or link: the emails read and what the
 * decision model made of each. The backend's answer is turned into the sidebar's shape here, and
 * the same text goes into the log, so a search that found nothing can be read afterwards.
 */

import {
  MAIL_SEARCH_STATE,
  VERIFICATION,
  type MailSearch,
  type MailSearchEmail,
  type VerificationKind,
} from "@acorn/shared/run-types";

/** One email as the backend sends it (its JSON, with the time as text). */
export interface RawMailEmail {
  id?: string;
  from?: string;
  subject?: string;
  receivedAt?: string;
  after?: boolean;
  judged?: boolean;
  probability?: number;
}

/** One email the backend opened to find the value: what it held, never the value itself. */
export interface RawMailOpened {
  subject?: string;
  /** What each code or link found was offered to the decision model as (a link without its query). */
  candidates?: string[];
  /** What the decision model answered: how many it saw, whether it chose one, the likeliest and how sure it was. */
  pick?: {
    candidates?: number;
    found?: boolean;
    best?: number;
    bestP?: number;
    confidence?: number;
  };
  /** Which candidate was used, or -1. */
  picked?: number;
  fallback?: boolean;
  unconfirmed?: boolean;
}

/** The longest sender or subject kept in the log: they are for reading, not for the whole text. */
const MAIL_TEXT_CHARS = 160;

const clip = (text: string | undefined): string => (text ?? "").slice(0, MAIL_TEXT_CHARS);

/** The emails of one look, in the shape the sidebar and the log keep. */
export function mailEmails(raw: RawMailEmail[] | undefined): MailSearchEmail[] {
  return (raw ?? []).map((email) => {
    const received = Date.parse(email.receivedAt ?? "");
    return {
      id: email.id ?? "",
      from: clip(email.from),
      subject: clip(email.subject),
      receivedAt: Number.isFinite(received) ? received : 0,
      after: email.after === true,
      judged: email.judged === true,
      probability: email.probability ?? 0,
    };
  });
}

/** A search that has just begun. */
export function startMailSearch(kind: VerificationKind, since: number): MailSearch {
  return { kind, state: MAIL_SEARCH_STATE.searching, since, looks: 0, emails: [] };
}

/** The search after another look: the newest list of emails replaces the last. */
export function afterLook(search: MailSearch, raw: RawMailEmail[] | undefined): MailSearch {
  const emails = raw === undefined ? search.emails : mailEmails(raw);
  return { ...search, looks: search.looks + 1, emails };
}

/** What the person reads of a value taken from an email: a code whole, a link without its query. */
export function shownValue(kind: VerificationKind, value: string): string {
  if (kind !== VERIFICATION.emailLink) return value;
  try {
    const link = new URL(value);
    return `${link.host}${link.pathname}`;
  } catch {
    return "";
  }
}

/** The search once the code or link was taken from an email. */
export function foundIn(
  search: MailSearch,
  messageId: string | undefined,
  value: string,
): MailSearch {
  return {
    ...search,
    state: MAIL_SEARCH_STATE.found,
    chosenId: messageId || undefined,
    shown: shownValue(search.kind, value) || undefined,
  };
}

/** The search once it ended without one. */
export function missed(search: MailSearch, detail?: string): MailSearch {
  return { ...search, state: MAIL_SEARCH_STATE.missed, detail };
}

/** What a look adds to the log: the emails and what each was judged, never an email's text. */
export function lookLogFields(search: MailSearch, model?: string, opened?: RawMailOpened[]) {
  return {
    opened: (opened ?? []).map((email) => ({
      subject: clip(email.subject),
      candidates: email.candidates ?? [],
      pick: email.pick ?? null,
      picked: email.picked ?? -1,
      fallback: email.fallback === true,
      unconfirmed: email.unconfirmed === true,
    })),
    kind: search.kind,
    looks: search.looks,
    since: search.since,
    model,
    emails: search.emails.map((email) => ({
      from: email.from,
      subject: email.subject,
      receivedAt: email.receivedAt,
      after: email.after,
      judged: email.judged,
      probability: email.probability,
    })),
  };
}

/** The sender's name without the address in angle brackets ("Acme <no-reply@acme.test>" is "Acme"). */
export function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/g, "").trim();
  return name || from.trim();
}

/** The email the decision model thinks most likely the site's, if it weighed any. */
export function likeliestEmailId(emails: MailSearchEmail[]): string | undefined {
  let best: MailSearchEmail | undefined;
  for (const email of emails) {
    if (email.judged && (!best || email.probability > best.probability)) best = email;
  }
  return best?.id;
}
