import type { ImapFlow } from 'imapflow';
import {
  extractCustomLabels,
  gmailLabelsToArray,
  messageToDoc,
  type MailMessageDoc,
} from '../mappers/folder-mapper';

export const LABEL_FETCH_CHUNK = 400;
export const ENVELOPE_FETCH_CHUNK = 50;

export type UidLabels = { uid: number; labels: string[] };

/**
 * Newest-first unlabeled INBOX UIDs from Gmail. Fetches X-GM-LABELS only —
 * no envelopes or bodies — so the unlabeled dialog can count without waiting
 * on a full mailbox download.
 */
export async function scanInboxUnlabeled(
  client: ImapFlow,
  maxScan: number,
): Promise<{ unlabeledUids: number[]; mailboxTotal: number; scanned: number }> {
  const box = client.mailbox;
  const mailboxTotal =
    box && typeof box === 'object' ? Number(box.exists ?? 0) : 0;
  if (mailboxTotal === 0) {
    return { unlabeledUids: [], mailboxTotal: 0, scanned: 0 };
  }
  const scanned = Math.min(maxScan, mailboxTotal);
  const start = mailboxTotal - scanned + 1;
  const unlabeledUids: number[] = [];
  for await (const message of client.fetch(`${start}:${mailboxTotal}`, {
    uid: true,
    labels: true,
  })) {
    const labels = gmailLabelsToArray(message.labels);
    if (extractCustomLabels(labels).length === 0 && message.uid > 0) {
      unlabeledUids.push(message.uid);
    }
  }
  unlabeledUids.sort((a, b) => b - a);
  return { unlabeledUids, mailboxTotal, scanned };
}

export async function fetchUidLabels(
  client: ImapFlow,
  uids: number[],
): Promise<UidLabels[]> {
  const out: UidLabels[] = [];
  for (let i = 0; i < uids.length; i += LABEL_FETCH_CHUNK) {
    const chunk = uids.slice(i, i + LABEL_FETCH_CHUNK);
    for await (const message of client.fetch(
      chunk.join(','),
      { uid: true, labels: true },
      { uid: true },
    )) {
      if (message.uid > 0) {
        out.push({
          uid: message.uid,
          labels: extractCustomLabels(gmailLabelsToArray(message.labels)),
        });
      }
    }
  }
  return out;
}

export function statsFromLabelRows(
  rows: UidLabels[],
  selected: string[],
): {
  matching: UidLabels[];
  summary: {
    total: number;
    unlabeled: number;
    labeled: number;
    byLabel: Array<{ label: string; count: number }>;
  };
} {
  const selectedSet = new Set(
    selected.map((s) => s.toLowerCase()).filter(Boolean),
  );
  const matching = selectedSet.size
    ? rows.filter((row) =>
        row.labels.some((label) => selectedSet.has(label.toLowerCase())),
      )
    : rows;
  const unlabeled = selectedSet.size
    ? 0
    : matching.filter((row) => row.labels.length === 0).length;
  const counts = new Map<string, number>();
  for (const row of matching) {
    for (const label of row.labels) {
      if (selectedSet.size && !selectedSet.has(label.toLowerCase())) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return {
    matching,
    summary: {
      total: matching.length,
      unlabeled,
      labeled: Math.max(0, matching.length - unlabeled),
      byLabel: [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    },
  };
}

export async function fetchEnvelopeDocs(
  client: ImapFlow,
  uids: number[],
  applierName: string,
  mailbox: string,
): Promise<MailMessageDoc[]> {
  if (!uids.length) return [];
  const messages: MailMessageDoc[] = [];
  for (let i = 0; i < uids.length; i += ENVELOPE_FETCH_CHUNK) {
    const chunk = uids.slice(i, i + ENVELOPE_FETCH_CHUNK);
    for await (const message of client.fetch(
      chunk.join(','),
      { envelope: true, flags: true, uid: true, labels: true },
      { uid: true },
    )) {
      messages.push(messageToDoc(message, applierName, mailbox));
    }
  }
  messages.sort((a, b) => b.date.getTime() - a.date.getTime());
  return messages;
}
