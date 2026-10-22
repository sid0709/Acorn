import { asText } from '../personal/mappers/as-text';
import { ALL_MAIL_PATH, MAIL_MESSAGE_ID_SEP } from './constants/mail.constants';

export type MailAiLabelResult = {
  id?: string;
  uid: number;
  label: string | null;
  applied: boolean;
  reason?:
    | 'applied'
    | 'no_match'
    | 'body_error'
    | 'classification_error'
    | 'gmail_error';
  error?: string;
};

export type MailAiLabelFailureClass =
  | 'ok'
  | 'empty'
  | 'message_id_parse'
  | 'gmail_imap'
  | 'llm_classify'
  | 'gmail_label_write'
  | 'mixed';

export type MailAiLabelProgress = {
  total: number;
  completed: number;
  failed: number;
  applied: number;
  skipped: number;
  phase:
    | 'loading_snippets'
    | 'classifying_snippet'
    | 'loading_body'
    | 'classifying_body'
    | 'labeling'
    | 'done';
  items?: Record<string, { result?: MailAiLabelResult }>;
};

export type MailAiLabelLoaded = {
  id: string;
  mailbox: string;
  uid: number;
  from: string;
  subject: string;
  preview: string;
  bodyText: string;
  gmailLabels: string[];
};

export function parseJsonLoose(text: string): unknown {
  const raw = String(text ?? '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(fenced.slice(first, last + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function resolveCanonicalLabel(
  raw: unknown,
  allowedLabels: string[],
): string | null {
  const candidate = asText(raw).trim();
  if (!candidate) return null;
  const exact = allowedLabels.find((label) => label === candidate);
  if (exact) return exact;
  const lower = candidate.toLowerCase();
  return allowedLabels.find((label) => label.toLowerCase() === lower) || null;
}

export function formatMessageId(mailbox: string, uid: number): string {
  return `${mailbox || ALL_MAIL_PATH}${MAIL_MESSAGE_ID_SEP}${uid}`;
}

export type ParsedMessageId = {
  mailbox: string;
  uid: number;
  /**
   * False when the id carried no mailbox. UIDs are per mailbox, so callers must
   * resolve the real mailbox from cache rather than trusting the fallback.
   */
  explicitMailbox: boolean;
};

export function parseMessageId(raw: string): ParsedMessageId {
  const s = String(raw || '');
  if (s.includes('\0')) {
    const [mailbox, uidStr] = s.split('\0');
    return {
      mailbox: mailbox || ALL_MAIL_PATH,
      uid: Number(uidStr),
      explicitMailbox: Boolean(mailbox),
    };
  }
  const dotted = /^(.*)::(\d+)$/.exec(s);
  if (dotted) {
    return {
      mailbox: dotted[1] || ALL_MAIL_PATH,
      uid: Number(dotted[2]),
      explicitMailbox: Boolean(dotted[1]),
    };
  }
  const idx = s.lastIndexOf(MAIL_MESSAGE_ID_SEP);
  if (idx > 0) {
    const uid = Number(s.slice(idx + MAIL_MESSAGE_ID_SEP.length));
    if (Number.isFinite(uid) && uid > 0) {
      return {
        mailbox: s.slice(0, idx) || ALL_MAIL_PATH,
        uid,
        explicitMailbox: true,
      };
    }
  }
  return { mailbox: ALL_MAIL_PATH, uid: Number(s), explicitMailbox: false };
}

export function mailAiLabelFailureClass(
  results: MailAiLabelResult[],
): MailAiLabelFailureClass {
  if (!results.length) return 'empty';
  const failed = results.filter(
    (row) => !row.applied && row.reason !== 'no_match',
  );
  if (!failed.length) return 'ok';
  const classes = new Set(
    failed.map((row) => {
      if (row.error === 'Invalid message id') return 'message_id_parse';
      if (row.reason === 'gmail_error') return 'gmail_label_write';
      if (row.reason === 'classification_error') return 'llm_classify';
      if (row.reason === 'body_error' && row.error === 'Message not found') {
        return 'gmail_imap';
      }
      if (row.reason === 'body_error') return 'message_id_parse';
      return 'mixed';
    }),
  );
  if (classes.size === 1) {
    return [...classes][0];
  }
  return 'mixed';
}

export function compactLlmError(message: string): string {
  const raw = String(message || '')
    .replace(/\s+/g, ' ')
    .trim();
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { message?: string };
        message?: string;
      };
      const inner = parsed.error?.message || parsed.message;
      if (inner) {
        return `${raw.slice(0, jsonStart).trim()} ${inner}`
          .trim()
          .slice(0, 240);
      }
    } catch {
      /* keep raw */
    }
  }
  return raw.slice(0, 240);
}

export function logMailAiLabel(
  logger: { log: (msg: string) => void },
  stage: string,
  data: Record<string, unknown>,
) {
  const bits = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      const text =
        typeof value === 'string' ? compactLlmError(value) : String(value);
      return `${key}=${text}`;
    });
  logger.log(`[mail_ai_label] ${stage} ${bits.join(' ')}`);
}

export function formatEmailText(
  email: MailAiLabelLoaded,
  maxChars: number,
): string {
  const body = (email.bodyText || email.preview || '')
    .trim()
    .slice(0, Math.max(1, maxChars));
  return [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Body:\n${body}`,
  ].join('\n');
}

export type ParsedClassifyResults = {
  labels: Record<string, string | null>;
  /** Requested ids the model never answered — retryable, not a real no-match. */
  missingIds: string[];
};

/**
 * Map model JSON onto requested ids. Null means the response was unparseable.
 * Ids are short ordinals, so an unmatched id means the model dropped the row.
 */
export function parseClassifyResults(
  text: string,
  ids: string[],
): ParsedClassifyResults | null {
  const parsed = parseJsonLoose(text) as {
    results?: Array<{ id?: unknown; label?: unknown }>;
  } | null;
  if (!parsed || !Array.isArray(parsed.results)) return null;
  const byId = new Map<string, string | null>();
  for (const row of parsed.results) {
    const id = asText(row?.id).trim();
    if (!id) continue;
    byId.set(id, row?.label == null ? null : asText(row.label));
  }
  const labels: Record<string, string | null> = {};
  const missingIds: string[] = [];
  for (const id of ids) {
    if (byId.has(id)) {
      labels[id] = byId.get(id)!;
    } else {
      labels[id] = null;
      missingIds.push(id);
    }
  }
  return { labels, missingIds };
}

/**
 * Models echo the `id` back, so long mailbox-qualified ids (`[Gmail]/All Mail::42`)
 * get mangled or dropped. Send short ordinals instead and translate locally.
 */
export function toOrdinalItems<T extends { id: string; text: string }>(
  items: T[],
): {
  ordinals: Array<{ id: string; text: string }>;
  realById: Map<string, string>;
} {
  const ordinals = items.map((item, index) => ({
    id: String(index + 1),
    text: item.text,
  }));
  const realById = new Map(
    ordinals.map((ordinal, index) => [ordinal.id, items[index].id]),
  );
  return { ordinals, realById };
}

/** Translate an ordinal-keyed classification back onto real message ids. */
export function mapOrdinalLabels(
  parsed: ParsedClassifyResults,
  realById: Map<string, string>,
): ParsedClassifyResults {
  const labels: Record<string, string | null> = {};
  for (const [ordinal, label] of Object.entries(parsed.labels)) {
    const real = realById.get(ordinal);
    if (real) labels[real] = label;
  }
  const missingIds = parsed.missingIds
    .map((ordinal) => realById.get(ordinal))
    .filter((id): id is string => Boolean(id));
  return { labels, missingIds };
}

export function mergeUsage(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!a && !b) return undefined;
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const av = a?.[key];
    const bv = b?.[key];
    out[key] =
      typeof av === 'number' || typeof bv === 'number'
        ? (typeof av === 'number' ? av : 0) + (typeof bv === 'number' ? bv : 0)
        : (av ?? bv);
  }
  return out;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError')
  );
}
