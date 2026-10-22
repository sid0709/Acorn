import { Injectable } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  ALL_MAIL_PATH,
  FOLDER_MAILBOX,
  IMAP_MAX_FOLDER_ENVELOPES,
  IMAP_MAX_FOLDER_LABELS,
  IMAP_MAX_NEW_ENVELOPES,
  IMAP_MAX_STATS_ENVELOPES,
} from '../constants/mail.constants';
import {
  displayLabelName,
  folderToMailbox,
  isSystemLabel,
  messageToDoc,
  toImapLabelToken,
  type MailMessageDoc,
} from '../mappers/folder-mapper';
import { ImapPoolService } from './imap-pool.service';
import { withImapRetry } from './imap-retry';
import { fetchTextBodiesByUids } from './imap-text-bodies';
import type { LensImapBody } from './imap-text-body';
import {
  fetchEnvelopeDocs,
  fetchUidLabels,
  scanInboxUnlabeled,
  statsFromLabelRows,
  type UidLabels,
} from './imap-fast-window';

@Injectable()
export class ImapClientService {
  constructor(private readonly pool: ImapPoolService) {}

  private withPath<T>(
    email: string,
    password: string,
    mailboxPath: string | undefined,
    fn: (client: ImapFlow) => Promise<T>,
  ) {
    return this.pool.withClient(email, password, mailboxPath, fn);
  }

  async verifyCredentials(email: string, password: string) {
    const normalizedEmail = String(email ?? '').trim();
    const normalizedPassword = String(password ?? '').replace(/\s/g, '');
    if (!normalizedEmail || !normalizedPassword) {
      return {
        ok: false as const,
        error: 'Email and Gmail app password are required.',
      };
    }
    try {
      await this.withPath(
        normalizedEmail,
        normalizedPassword,
        undefined,
        async () => true,
      );
      return { ok: true as const, email: normalizedEmail };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'IMAP connection failed';
      return { ok: false as const, error: message, email: normalizedEmail };
    }
  }

  async fetchMailboxPage(
    email: string,
    password: string,
    folder: string,
    page: number,
    pageSize: number,
    applierName: string,
  ): Promise<{ messages: MailMessageDoc[]; total: number; mailbox: string }> {
    const mailboxPath = folderToMailbox(folder);
    return this.withPath(email, password, mailboxPath, async (client) => {
      const box = client.mailbox;
      const total = box && typeof box === 'object' ? (box.exists ?? 0) : 0;
      if (total === 0) return { messages: [], total: 0, mailbox: mailboxPath };

      const size = Math.min(Math.max(pageSize, 1), 100);
      const end = total - (page - 1) * size;
      const start = Math.max(1, end - size + 1);
      if (end < 1) return { messages: [], total, mailbox: mailboxPath };

      const messages: MailMessageDoc[] = [];
      for await (const message of client.fetch(`${start}:${end}`, {
        envelope: true,
        flags: true,
        uid: true,
        labels: true,
      })) {
        const doc = messageToDoc(message, applierName, mailboxPath);
        doc.folder = folder;
        messages.push(doc);
      }
      messages.reverse();
      return { messages, total, mailbox: mailboxPath };
    });
  }

  /**
   * Unlabeled INBOX page from Gmail: labels-only scan, then envelopes for this
   * page only. No message bodies.
   */
  async fetchUnlabeledInboxPage(
    email: string,
    password: string,
    applierName: string,
    opts: { page?: number; pageSize?: number; maxScan?: number } = {},
  ): Promise<{
    messages: MailMessageDoc[];
    unlabeledTotal: number;
    mailboxTotal: number;
    unlabeledUids: number[];
  }> {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const maxScan = Math.min(
      Math.max(opts.maxScan || IMAP_MAX_FOLDER_LABELS, 1),
      IMAP_MAX_FOLDER_LABELS,
    );
    return this.withPath(email, password, 'INBOX', async (client) => {
      const scan = await scanInboxUnlabeled(client, maxScan);
      const start = (page - 1) * pageSize;
      const pageUids = scan.unlabeledUids.slice(start, start + pageSize);
      const messages = await fetchEnvelopeDocs(
        client,
        pageUids,
        applierName,
        'INBOX',
      );
      return {
        messages,
        unlabeledTotal: scan.unlabeledUids.length,
        mailboxTotal: scan.mailboxTotal,
        unlabeledUids: scan.unlabeledUids,
      };
    });
  }

  /** Labels-only unlabeled count — skips envelopes entirely. */
  async countUnlabeledInbox(
    email: string,
    password: string,
    maxScan = IMAP_MAX_FOLDER_LABELS,
  ): Promise<number> {
    const scan = await this.scanUnlabeledInbox(email, password, maxScan);
    return scan.unlabeledUids.length;
  }

  /** Labels-only unlabeled INBOX scan. No envelopes or bodies. */
  async scanUnlabeledInbox(
    email: string,
    password: string,
    maxScan = IMAP_MAX_FOLDER_LABELS,
  ): Promise<{
    unlabeledUids: number[];
    mailboxTotal: number;
    scanned: number;
  }> {
    const cap = Math.min(Math.max(maxScan, 1), IMAP_MAX_FOLDER_LABELS);
    return this.withPath(email, password, 'INBOX', (client) =>
      scanInboxUnlabeled(client, cap),
    );
  }

  async fetchEnvelopesByUids(
    email: string,
    password: string,
    mailbox: string,
    uids: number[],
    applierName: string,
  ): Promise<MailMessageDoc[]> {
    if (!uids.length) return [];
    return this.withPath(email, password, mailbox, (client) =>
      fetchEnvelopeDocs(client, uids, applierName, mailbox),
    );
  }

  /**
   * All Mail stats: SEARCH, labels-only for counts, envelopes for one page.
   */
  async fetchAllMailStatsPage(
    email: string,
    password: string,
    applierName: string,
    opts: {
      since?: Date;
      before?: Date;
      selected?: string[];
      page?: number;
      pageSize?: number;
      max?: number;
    } = {},
  ): Promise<{
    total: number;
    unlabeled: number;
    labeled: number;
    byLabel: Array<{ label: string; count: number }>;
    messages: MailMessageDoc[];
    allRows: UidLabels[];
  }> {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const cap = Math.min(
      Math.max(opts.max || IMAP_MAX_STATS_ENVELOPES, 1),
      IMAP_MAX_STATS_ENVELOPES,
    );
    const selected = (opts.selected || []).map((s) => s.trim()).filter(Boolean);
    return this.withPath(email, password, ALL_MAIL_PATH, async (client) => {
      const uids = await allMailUids(client, opts.since, opts.before, cap);
      const allRows = await fetchUidLabels(client, uids);
      allRows.sort((a, b) => b.uid - a.uid);
      const stats = statsFromLabelRows(allRows, selected);
      const start = (page - 1) * pageSize;
      const pageUids = stats.matching
        .slice(start, start + pageSize)
        .map((row) => row.uid);
      const messages = await fetchEnvelopeDocs(
        client,
        pageUids,
        applierName,
        ALL_MAIL_PATH,
      );
      return { ...stats.summary, messages, allRows };
    });
  }

  /**
   * Newest envelopes in a Gmail folder. Used to refresh the cache from IMAP
   * (source of truth) instead of paging only what Mongo already has.
   */
  async fetchMailboxWindow(
    email: string,
    password: string,
    folder: string,
    applierName: string,
    max = IMAP_MAX_FOLDER_ENVELOPES,
  ): Promise<{ messages: MailMessageDoc[]; mailboxTotal: number }> {
    const mailboxPath = folderToMailbox(folder);
    const cap = Math.min(Math.max(max, 1), IMAP_MAX_FOLDER_ENVELOPES);
    return this.withPath(email, password, mailboxPath, async (client) => {
      const box = client.mailbox;
      const mailboxTotal =
        box && typeof box === 'object' ? Number(box.exists ?? 0) : 0;
      if (mailboxTotal === 0) return { messages: [], mailboxTotal: 0 };
      const start = Math.max(1, mailboxTotal - cap + 1);
      const messages: MailMessageDoc[] = [];
      for await (const message of client.fetch(`${start}:${mailboxTotal}`, {
        envelope: true,
        flags: true,
        uid: true,
        labels: true,
      })) {
        messages.push(messageToDoc(message, applierName, mailboxPath));
      }
      messages.sort((a, b) => b.date.getTime() - a.date.getTime());
      return { messages, mailboxTotal };
    });
  }

  /**
   * All Mail envelopes in a date window (Gmail's real mailbox). Caps at
   * IMAP_MAX_STATS_ENVELOPES newest matches so a huge account cannot fill RAM.
   */
  async fetchAllMailWindow(
    email: string,
    password: string,
    applierName: string,
    opts: { since?: Date; before?: Date; max?: number } = {},
  ): Promise<MailMessageDoc[]> {
    const cap = Math.min(
      Math.max(opts.max || IMAP_MAX_STATS_ENVELOPES, 1),
      IMAP_MAX_STATS_ENVELOPES,
    );
    return this.withPath(email, password, ALL_MAIL_PATH, async (client) => {
      const uids = await allMailUids(client, opts.since, opts.before, cap);
      if (!uids.length) return [];
      const messages: MailMessageDoc[] = [];
      for (let i = 0; i < uids.length; i += FETCH_UID_CHUNK) {
        const chunk = uids.slice(i, i + FETCH_UID_CHUNK);
        for await (const message of client.fetch(
          chunk.join(','),
          { envelope: true, flags: true, uid: true, labels: true },
          { uid: true },
        )) {
          messages.push(messageToDoc(message, applierName, ALL_MAIL_PATH));
        }
      }
      messages.sort((a, b) => b.date.getTime() - a.date.getTime());
      return messages;
    });
  }

  async fetchNewEnvelopes(
    email: string,
    password: string,
    highestUid: number,
    applierName: string,
  ): Promise<MailMessageDoc[]> {
    return this.withPath(email, password, ALL_MAIL_PATH, async (client) => {
      const box = client.mailbox;
      const total =
        box && typeof box === 'object' ? Number(box.exists ?? 0) : 0;
      if (total === 0) return [];

      const range =
        highestUid > 0
          ? `${highestUid + 1}:*`
          : `${Math.max(1, total - IMAP_MAX_NEW_ENVELOPES + 1)}:${total}`;
      const fetchOpts = highestUid > 0 ? { uid: true as const } : undefined;
      const messages: MailMessageDoc[] = [];
      try {
        for await (const message of client.fetch(
          range,
          {
            envelope: true,
            flags: true,
            uid: true,
            labels: true,
          },
          fetchOpts,
        )) {
          if (message.uid <= highestUid) continue;
          messages.push(messageToDoc(message, applierName, ALL_MAIL_PATH));
          if (messages.length >= IMAP_MAX_NEW_ENVELOPES) break;
        }
      } catch {
        /* empty range */
      }
      messages.sort((a, b) => b.uid - a.uid);
      return messages;
    });
  }

  async fetchMessageBody(
    email: string,
    password: string,
    uid: number,
    mailboxPath = ALL_MAIL_PATH,
  ): Promise<{ bodyText: string; bodyHtml: string | null; preview: string }> {
    return this.withPath(email, password, mailboxPath, async (client) => {
      const downloaded = await client.download(String(uid), undefined, {
        uid: true,
      });
      if (!downloaded?.content) {
        throw new Error('Message not found');
      }
      const parsed = await simpleParser(downloaded.content);
      let bodyHtml: string | null = null;
      if (typeof parsed.html === 'string' && parsed.html.trim()) {
        bodyHtml = parsed.html.trim();
      } else if (
        typeof parsed.textAsHtml === 'string' &&
        parsed.textAsHtml.trim()
      ) {
        bodyHtml = parsed.textAsHtml.trim();
      }
      const bodyText =
        (typeof parsed.text === 'string' && parsed.text.trim()) ||
        (bodyHtml
          ? bodyHtml
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          : '');
      return {
        bodyText,
        bodyHtml,
        preview: bodyText.slice(0, 120) || parsed.subject?.slice(0, 120) || '',
      };
    });
  }

  async fetchMessagePlainText(
    email: string,
    password: string,
    uid: number,
    mailboxPath = ALL_MAIL_PATH,
    maxChars = 4000,
  ): Promise<string> {
    const body = await this.fetchMessageBody(email, password, uid, mailboxPath);
    return body.bodyText.slice(0, maxChars);
  }

  async fetchFolderCounts(email: string, password: string) {
    return this.withPath(email, password, undefined, async (client) => {
      const counts: Record<
        string,
        { total: number; unread: number; badge: number }
      > = {};
      for (const [folder, path] of Object.entries(FOLDER_MAILBOX)) {
        const status = await client.status(path, {
          messages: true,
          unseen: true,
        });
        const total = Number(status.messages ?? 0);
        const unread = Number(status.unseen ?? 0);
        counts[folder] = { total, unread, badge: unread };
      }
      return counts;
    });
  }

  async fetchGmailLabelList(email: string, password: string) {
    return this.withPath(email, password, undefined, async (client) => {
      const mailboxes = await client.list();
      const labels: Array<{
        id: string;
        name: string;
        shortName: string;
        path: string;
        parentId?: string;
        color?: string;
      }> = [];

      for (const box of mailboxes) {
        const path = displayLabelName(box.path);
        if (
          !path ||
          path.startsWith('[Gmail]') ||
          path.startsWith('[Google]')
        ) {
          continue;
        }
        if (isSystemLabel(path)) continue;

        const parts = path.split('/');
        const name = parts[parts.length - 1];
        const parentPath =
          parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
        const parentId = parentPath
          ? parentPath.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          : undefined;

        labels.push({
          id: path.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: path,
          shortName: name,
          path,
          parentId,
          color: '#6366f1',
        });
      }

      labels.sort((a, b) => a.name.localeCompare(b.name));
      return labels;
    });
  }

  async createGmailLabel(
    email: string,
    password: string,
    name: string,
    parentPath?: string,
  ) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('Label name required');
    const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;

    return this.withPath(email, password, undefined, async (client) => {
      await client.mailboxCreate(fullPath);
      const parts = fullPath.split('/');
      return {
        id: fullPath.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: fullPath,
        shortName: parts[parts.length - 1],
        path: fullPath,
        parentId: parentPath
          ? parentPath.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          : undefined,
        color: '#6366f1',
      };
    });
  }

  async deleteGmailLabel(email: string, password: string, labelPath: string) {
    const path = String(labelPath ?? '').trim();
    if (!path) throw new Error('Label path required');
    return this.withPath(email, password, undefined, async (client) => {
      await client.mailboxDelete(path);
      return { deleted: path };
    });
  }

  async setMessageSeen(
    email: string,
    password: string,
    uid: number,
    seen: boolean,
    mailboxPath = ALL_MAIL_PATH,
  ) {
    return this.withPath(email, password, mailboxPath, async (client) => {
      if (seen) {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
      }
    });
  }

  async setMessageFlagged(
    email: string,
    password: string,
    uid: number,
    flagged: boolean,
    mailboxPath = ALL_MAIL_PATH,
  ) {
    return this.withPath(email, password, mailboxPath, async (client) => {
      if (flagged) {
        await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
      } else {
        await client.messageFlagsRemove(String(uid), ['\\Flagged'], {
          uid: true,
        });
      }
    });
  }

  async archiveMessage(
    email: string,
    password: string,
    uid: number,
    mailboxPath = ALL_MAIL_PATH,
  ) {
    return this.withPath(email, password, mailboxPath, async (client) => {
      await client.messageFlagsRemove(String(uid), ['\\Inbox'], {
        uid: true,
        useLabels: true,
      });
    });
  }

  async trashMessage(
    email: string,
    password: string,
    uid: number,
    mailboxPath = ALL_MAIL_PATH,
  ) {
    return this.withPath(email, password, mailboxPath, async (client) => {
      await client.messageFlagsAdd(String(uid), ['\\Trash'], {
        uid: true,
        useLabels: true,
      });
      await client.messageFlagsRemove(String(uid), ['\\Inbox'], {
        uid: true,
        useLabels: true,
      });
    });
  }

  async moveToInbox(
    email: string,
    password: string,
    uid: number,
    mailboxPath = ALL_MAIL_PATH,
  ) {
    return this.withPath(email, password, mailboxPath, async (client) => {
      await client.messageFlagsAdd(String(uid), ['\\Inbox'], {
        uid: true,
        useLabels: true,
      });
      await client.messageFlagsRemove(String(uid), ['\\Trash'], {
        uid: true,
        useLabels: true,
      });
    });
  }

  async addLabelsToMessages(
    email: string,
    password: string,
    uids: number[],
    labelNames: string[],
    mailboxPath = ALL_MAIL_PATH,
    options?: { signal?: AbortSignal },
  ) {
    const tokens = (labelNames || [])
      .map(toImapLabelToken)
      .filter((t): t is string => Boolean(t));
    const uidSet = [
      ...new Set((uids || []).map(Number).filter(Number.isFinite)),
    ].join(',');
    if (!tokens.length || !uidSet) return;
    return withImapRetry(
      () =>
        this.withPath(email, password, mailboxPath, async (client) => {
          await client.messageFlagsAdd(uidSet, tokens, {
            uid: true,
            useLabels: true,
          });
        }),
      { signal: options?.signal },
    );
  }

  async removeLabelsFromMessage(
    email: string,
    password: string,
    uid: number,
    labelNames: string[],
    mailboxPath = ALL_MAIL_PATH,
  ) {
    const tokens = (labelNames || [])
      .map(toImapLabelToken)
      .filter((t): t is string => Boolean(t));
    if (!tokens.length) return;
    return this.withPath(email, password, mailboxPath, async (client) => {
      await client.messageFlagsRemove(String(uid), tokens, {
        uid: true,
        useLabels: true,
      });
    });
  }

  async fetchEnvelopeForUid(
    email: string,
    password: string,
    uid: number,
    applierName: string,
    mailboxPath = ALL_MAIL_PATH,
  ): Promise<MailMessageDoc | null> {
    return this.withPath(email, password, mailboxPath, async (client) => {
      for await (const message of client.fetch(
        String(uid),
        {
          envelope: true,
          flags: true,
          uid: true,
          labels: true,
        },
        { uid: true },
      )) {
        return messageToDoc(message, applierName, mailboxPath);
      }
      return null;
    });
  }

  /**
   * Page envelopes from a Gmail label mailbox (labels are IMAP folders).
   * Newest-first; page 1 is the latest pageSize messages.
   */
  async fetchLabelMailboxEnvelopes(
    email: string,
    password: string,
    mailboxPath: string,
    opts: { page?: number; pageSize?: number } = {},
  ): Promise<{
    messages: Array<{
      uid: number;
      from: string;
      fromName: string;
      subject: string;
      date: Date | null;
      seen: boolean;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    const path = String(mailboxPath || '').trim();
    if (!path) throw new Error('mailboxPath is required');
    return this.withPath(email, password, path, async (client) => {
      const box = client.mailbox;
      const total = box && typeof box === 'object' ? (box.exists ?? 0) : 0;
      if (total === 0) return { messages: [], total: 0, hasMore: false };

      const size = Math.min(Math.max(Number(opts.pageSize) || 15, 1), 50);
      const pageNumber = Math.max(1, Number(opts.page) || 1);
      const end = total - (pageNumber - 1) * size;
      const start = Math.max(1, end - size + 1);
      if (end < 1) return { messages: [], total, hasMore: false };

      const messages: Array<{
        uid: number;
        from: string;
        fromName: string;
        subject: string;
        date: Date | null;
        seen: boolean;
      }> = [];
      for await (const message of client.fetch(`${start}:${end}`, {
        envelope: true,
        flags: true,
        uid: true,
      })) {
        const from = message.envelope?.from?.[0];
        messages.push({
          uid: message.uid,
          from: from?.address || '',
          fromName: from?.name || from?.address || '',
          subject: message.envelope?.subject || '',
          date: message.envelope?.date ?? null,
          seen: message.flags?.has('\\Seen') ?? false,
        });
      }

      messages.sort(
        (left, right) =>
          new Date(right.date || 0).getTime() -
          new Date(left.date || 0).getTime(),
      );
      return { messages, total, hasMore: start > 1 };
    });
  }

  /**
   * Envelope + truncated text MIME parts in one UID-set FETCH (one mailbox lock).
   */
  async fetchTextBodiesByUid(
    email: string,
    password: string,
    mailboxPath: string,
    uids: number[],
    maxBytes = 100_000,
  ): Promise<LensImapBody[]> {
    const path = String(mailboxPath || '').trim();
    if (!path) throw new Error('mailboxPath is required');
    const requested = [
      ...new Set(uids.filter((uid) => Number.isSafeInteger(uid) && uid > 0)),
    ];
    if (!requested.length) return [];

    return this.withPath(email, password, path, (client) =>
      fetchTextBodiesByUids(client, requested, maxBytes),
    );
  }
}

const FETCH_UID_CHUNK = 80;

async function allMailUids(
  client: ImapFlow,
  since: Date | undefined,
  before: Date | undefined,
  cap: number,
): Promise<number[]> {
  if (since || before) {
    const found = await client.search(
      {
        ...(since ? { since } : {}),
        ...(before ? { before } : {}),
      },
      { uid: true },
    );
    const uids = Array.isArray(found)
      ? found.map(Number).filter((uid) => uid > 0)
      : [];
    uids.sort((a, b) => a - b);
    return uids.length > cap ? uids.slice(uids.length - cap) : uids;
  }

  const box = client.mailbox;
  const total = box && typeof box === 'object' ? Number(box.exists ?? 0) : 0;
  if (total === 0) return [];
  const start = Math.max(1, total - cap + 1);
  const uids: number[] = [];
  for await (const message of client.fetch(`${start}:${total}`, {
    uid: true,
  })) {
    if (message.uid > 0) uids.push(message.uid);
  }
  return uids;
}
