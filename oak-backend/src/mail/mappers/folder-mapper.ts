import {
  ALL_MAIL_PATH,
  FOLDER_MAILBOX,
  SYSTEM_LABELS,
} from '../constants/mail.constants';

export function folderToMailbox(folder: string): string {
  return FOLDER_MAILBOX[folder] || ALL_MAIL_PATH;
}

export function normalizeLabel(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/^\\+/, '')
    .trim();
}

export function displayLabelName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/^\\+/, '')
    .trim();
}

export function isSystemLabel(raw: unknown): boolean {
  const n = normalizeLabel(raw);
  if (SYSTEM_LABELS.has(n)) return true;
  if (n.startsWith('category_')) return true;
  if (n.startsWith('[gmail]')) return true;
  if (n.startsWith('[google]')) return true;
  return false;
}

export function extractCustomLabels(gmailLabels: unknown): string[] {
  if (!Array.isArray(gmailLabels)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of gmailLabels) {
    const name = displayLabelName(raw);
    if (!name || isSystemLabel(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function toImapLabelToken(labelName: unknown): string | null {
  const raw = String(labelName ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('\\')) return raw;
  return displayLabelName(raw);
}

function hasLabel(labels: Set<string> | undefined, target: string): boolean {
  if (!labels || labels.size === 0) return false;
  const normalized = [...labels].map(normalizeLabel);
  const t = normalizeLabel(target);
  return normalized.some((l) => l === t || l.endsWith(`/${t}`));
}

export function mapGmailLabelsToFolder(
  labels: Set<string> | undefined,
): string {
  if (!labels || labels.size === 0) return 'archive';
  if (hasLabel(labels, '\\trash') || hasLabel(labels, 'trash')) return 'trash';
  if (hasLabel(labels, '\\junk') || hasLabel(labels, 'spam')) return 'spam';
  if (hasLabel(labels, '\\drafts') || hasLabel(labels, 'drafts'))
    return 'drafts';
  if (hasLabel(labels, '\\sent') || hasLabel(labels, 'sent')) return 'sent';
  if (hasLabel(labels, '\\inbox') || hasLabel(labels, 'inbox')) return 'inbox';
  return 'archive';
}

export function gmailLabelsToArray(labels: Set<string> | undefined): string[] {
  if (!labels || labels.size === 0) return [];
  return [...labels].map((l) => displayLabelName(l));
}

export function labelsMatchFilter(
  gmailLabels: string[] | undefined,
  filterLabel: string | undefined,
): boolean {
  if (!filterLabel) return true;
  const target = normalizeLabel(filterLabel);
  return (gmailLabels || []).some((raw) => {
    const name = normalizeLabel(raw);
    return (
      name === target || name.endsWith(`/${target}`) || name.includes(target)
    );
  });
}

export type MailAddress = { name: string; email: string };

export type MailMessageDoc = {
  applierName: string;
  mailbox: string;
  uid: number;
  messageId: string | null;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  preview: string;
  bodyText: string;
  bodyHtml: string | null;
  date: Date;
  flags: { seen: boolean; flagged: boolean };
  gmailLabels: string[];
  folder: string;
  labels: string[];
  hasBody: boolean;
  syncedAt: Date;
};

type ImapEnvelopeAddr = { name?: string; address?: string };

function envelopeFrom(message: {
  envelope?: { from?: ImapEnvelopeAddr[] };
}): MailAddress {
  const from = message.envelope?.from?.[0];
  return {
    name: from?.name || from?.address || 'Unknown',
    email: from?.address || '',
  };
}

function envelopeToArray(field: ImapEnvelopeAddr[] | undefined): MailAddress[] {
  if (!Array.isArray(field)) return [];
  return field.map((addr) => ({
    name: addr?.name || addr?.address || '',
    email: addr?.address || '',
  }));
}

export function messageToDoc(
  message: {
    uid: number;
    envelope?: {
      from?: ImapEnvelopeAddr[];
      to?: ImapEnvelopeAddr[];
      cc?: ImapEnvelopeAddr[];
      subject?: string;
      date?: Date;
      messageId?: string;
    };
    flags?: Set<string>;
    labels?: Set<string>;
  },
  applierName: string,
  mailbox = ALL_MAIL_PATH,
): MailMessageDoc {
  const from = envelopeFrom(message);
  const gmailLabels = gmailLabelsToArray(message.labels);
  const customLabels = extractCustomLabels(gmailLabels);
  const folder = mapGmailLabelsToFolder(message.labels);
  const subject = message.envelope?.subject || '(No subject)';
  const date = message.envelope?.date ?? new Date();
  const seen = message.flags?.has('\\Seen') ?? false;
  const flagged = message.flags?.has('\\Flagged') ?? false;

  return {
    applierName,
    mailbox,
    uid: message.uid,
    messageId: message.envelope?.messageId || null,
    from,
    to: envelopeToArray(message.envelope?.to),
    cc: envelopeToArray(message.envelope?.cc),
    subject,
    preview: subject.slice(0, 120),
    bodyText: '',
    bodyHtml: null,
    date,
    flags: { seen, flagged },
    gmailLabels,
    folder,
    labels: customLabels,
    hasBody: false,
    syncedAt: new Date(),
  };
}
