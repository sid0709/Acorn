import { extractCustomLabels } from './folder-mapper';
import { ALL_MAIL_PATH } from '../constants/mail.constants';

export type ThreadLikeDoc = {
  uid: number;
  mailbox?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  from?: { name?: string; email?: string } | null;
  subject?: string | null;
  preview?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  date: Date | string;
  seen?: boolean;
  flagged?: boolean;
  flags?: { seen?: boolean; flagged?: boolean } | null;
  gmailLabels?: string[] | null;
  labels?: string[] | null;
  folder?: string | null;
  hasBody?: boolean;
};

function formatMailTime(date: Date): string {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function messageToThread(
  doc: ThreadLikeDoc,
  { includeBody = true }: { includeBody?: boolean } = {},
) {
  const date = doc.date instanceof Date ? doc.date : new Date(doc.date || 0);
  const safeDate = Number.isNaN(date.getTime()) ? new Date(0) : date;
  const gmailLabels = doc.gmailLabels?.length
    ? doc.gmailLabels
    : doc.labels || [];
  const customLabels = doc.gmailLabels?.length
    ? extractCustomLabels(doc.gmailLabels)
    : (doc.labels || []).filter((l) => l !== 'starred' && l !== 'Starred');

  const fromName =
    doc.from?.name ||
    doc.fromName ||
    doc.from?.email ||
    doc.fromEmail ||
    'Unknown';
  const fromEmail = doc.from?.email || doc.fromEmail || '';
  const seen = doc.flags?.seen ?? doc.seen ?? false;
  const flagged = doc.flags?.flagged ?? doc.flagged ?? false;

  return {
    id: String(doc.uid),
    uid: doc.uid,
    mailbox: doc.mailbox || ALL_MAIL_PATH,
    from: fromName,
    fromEmail,
    subj: doc.subject || '(No subject)',
    prev: doc.preview || '',
    body: includeBody ? doc.bodyText || doc.preview || '' : doc.preview || '',
    bodyHtml: includeBody ? doc.bodyHtml || null : null,
    time: formatMailTime(safeDate),
    date: safeDate.toISOString(),
    unread: !seen,
    starred: Boolean(flagged),
    tag: customLabels[0] || '',
    folder: doc.folder || 'inbox',
    labels: customLabels,
    gmailLabels: gmailLabels || [],
    hasBody: Boolean(doc.hasBody),
  };
}
