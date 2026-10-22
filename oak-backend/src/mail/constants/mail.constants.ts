export const ALL_MAIL_PATH = '[Gmail]/All Mail';

export const FOLDER_MAILBOX: Record<string, string> = {
  inbox: 'INBOX',
  sent: '[Gmail]/Sent Mail',
  drafts: '[Gmail]/Drafts',
  trash: '[Gmail]/Trash',
  spam: '[Gmail]/Spam',
};

export const SYSTEM_LABELS = new Set([
  'inbox',
  'sent',
  'drafts',
  'trash',
  'spam',
  'starred',
  'important',
  'unread',
  'chat',
  'all mail',
  'all',
  'archive',
]);

export const MAIL_DEFINITION_MAX_CHARS = 2000;
export const MAIL_PAGE_SIZE_MAX = 100;

/** Folders omitted from Mail Statistics (deleted / junk). */
export const MAIL_STATS_EXCLUDED_FOLDERS = ['trash', 'spam'] as const;

/** Cap on selected custom labels for GET /mail/stats. */
export const MAIL_STATS_MAX_LABELS = 50;

/** Messages handled by one `runBatch` call, and the backlog chunk size. */
export const MAIL_AI_LABEL_MAX_MESSAGES = 50;

/** Full-group classify attempts before the batch is halved and retried. */
export const MAIL_AI_LABEL_CLASSIFY_ATTEMPTS = 2;

/** `mail_ai_label` task payload discriminator. */
export const MAIL_AI_LABEL_SCOPES = {
  SELECTION: 'selection',
  UNLABELED_BACKLOG: 'unlabeled_backlog',
} as const;

export type MailAiLabelScope =
  (typeof MAIL_AI_LABEL_SCOPES)[keyof typeof MAIL_AI_LABEL_SCOPES];

/** Safety ceiling on one backlog task so a huge mailbox cannot run forever. */
export const MAIL_AI_LABEL_BACKLOG_MAX_MESSAGES = 2000;

/**
 * Detailed per-message rows kept in task progress/result. Aggregate counts stay
 * exact; only the retained detail is trimmed so the task document and SSE
 * payload cannot grow with the size of the backlog.
 */
export const MAIL_AI_LABEL_MAX_RESULT_ROWS = 200;

/** BSON-safe mailbox/uid key. Do not use NUL — Mongo raw updates reject it. */
export const MAIL_MESSAGE_ID_SEP = '::';

/** Cap incremental / first-sync envelope fetch so All Mail cannot fill the heap. */
export const IMAP_MAX_NEW_ENVELOPES = 200;

/** Newest INBOX envelopes pulled from Gmail when listing unlabeled mail. */
export const IMAP_MAX_FOLDER_ENVELOPES = 500;

/**
 * Newest INBOX messages scanned for X-GM-LABELS only (no envelopes/bodies)
 * when counting unlabeled mail. Labels are cheap; this can exceed the
 * envelope window.
 */
export const IMAP_MAX_FOLDER_LABELS = 2000;

/** Newest All Mail envelopes pulled from Gmail for the Statistics window. */
export const IMAP_MAX_STATS_ENVELOPES = 2000;

/** Skip a second Gmail pull for the same applier within this window. */
export const MAIL_IMAP_REFRESH_STALE_MS = 15_000;

export const BETA_TIER = 'beta';
