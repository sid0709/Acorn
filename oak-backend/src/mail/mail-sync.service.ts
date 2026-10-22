import { Injectable } from '@nestjs/common';
import {
  ALL_MAIL_PATH,
  IMAP_MAX_FOLDER_ENVELOPES,
  IMAP_MAX_STATS_ENVELOPES,
  MAIL_IMAP_REFRESH_STALE_MS,
} from './constants/mail.constants';
import { ImapClientService } from './imap/imap-client.service';
import { statsFromLabelRows, type UidLabels } from './imap/imap-fast-window';
import { MailCacheService } from './mail-cache.service';
import type { MailCredentialsOk } from './mail-credentials.service';
import type { MailMessageDoc } from './mappers/folder-mapper';

type UnlabeledScanCache = {
  at: number;
  uids: number[];
  mailboxTotal: number;
};

type StatsScanCache = {
  at: number;
  rows: UidLabels[];
};

@Injectable()
export class MailSyncService {
  private readonly inboxRefreshAt = new Map<string, number>();
  private readonly statsRefreshAt = new Map<string, number>();
  private readonly unlabeledScan = new Map<string, UnlabeledScanCache>();
  private readonly unlabeledWait = new Map<
    string,
    Promise<UnlabeledScanCache>
  >();
  private readonly statsScan = new Map<string, StatsScanCache>();

  constructor(
    private readonly imap: ImapClientService,
    private readonly cache: MailCacheService,
  ) {}

  async syncIncremental(creds: MailCredentialsOk) {
    const state = await this.cache.getSyncState(creds.applierName);
    if (state?.syncing) return { newCount: 0, updatedCount: 0, skipped: true };
    await this.cache.upsertSyncState(creds.applierName, { syncing: true });
    try {
      const highest = state?.highestUid ?? 0;
      const messages = await this.imap.fetchNewEnvelopes(
        creds.email,
        creds.password,
        highest,
        creds.applierName,
      );
      if (messages.length) {
        await this.cache.upsertMessages(messages);
        const uids = messages.map((m) => m.uid);
        await this.cache.upsertSyncState(creds.applierName, {
          highestUid: Math.max(highest, ...uids),
          lastSyncAt: new Date(),
          syncing: false,
        });
      } else {
        await this.cache.upsertSyncState(creds.applierName, {
          lastSyncAt: new Date(),
          syncing: false,
        });
      }
      return { newCount: messages.length, updatedCount: 0 };
    } catch (err) {
      await this.cache.upsertSyncState(creds.applierName, { syncing: false });
      throw err;
    }
  }

  invalidateUnlabeledScan(applierName: string) {
    this.unlabeledScan.delete(applierName);
    this.inboxRefreshAt.delete(applierName);
  }

  private cacheInBackground(messages: MailMessageDoc[]) {
    if (!messages.length) return;
    void this.cache.upsertMessages(messages).catch(() => {
      /* cache is best-effort; the Gmail list already returned */
    });
  }

  /**
   * Labels-only unlabeled INBOX UIDs from Gmail. Shared by the dialog count
   * and list so they do not each open a second IMAP scan.
   */
  async getUnlabeledUids(
    creds: MailCredentialsOk,
    force = false,
  ): Promise<number[]> {
    const scan = await this.ensureUnlabeledScan(creds, force);
    return scan.uids;
  }

  async countUnlabeledInbox(
    creds: MailCredentialsOk,
    force = false,
  ): Promise<number> {
    const scan = await this.ensureUnlabeledScan(creds, force);
    return scan.uids.length;
  }

  /**
   * Unlabeled INBOX page: labels-only scan, then envelopes for this page.
   * Bodies stay off this path.
   */
  async fetchUnlabeledPage(
    creds: MailCredentialsOk,
    opts: { page?: number; pageSize?: number; force?: boolean } = {},
  ): Promise<{
    messages: MailMessageDoc[];
    unlabeledTotal: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const cached = freshUnlabeledScan(
      this.unlabeledScan.get(creds.applierName),
    );
    if (!opts.force && cached) {
      return this.envelopesForUnlabeledPage(creds, cached, page, pageSize);
    }

    const live = await this.imap.fetchUnlabeledInboxPage(
      creds.email,
      creds.password,
      creds.applierName,
      { page, pageSize },
    );
    this.unlabeledScan.set(creds.applierName, {
      at: Date.now(),
      uids: live.unlabeledUids,
      mailboxTotal: live.mailboxTotal,
    });
    this.inboxRefreshAt.set(creds.applierName, Date.now());
    this.cacheInBackground(live.messages);
    return {
      messages: live.messages,
      unlabeledTotal: live.unlabeledTotal,
      page,
      pageSize,
    };
  }

  /**
   * Pull current INBOX envelopes from Gmail and write them through the cache.
   * Unlabeled / AI Label must not treat Mongo as the mailbox.
   */
  async refreshInbox(
    creds: MailCredentialsOk,
    force = false,
  ): Promise<boolean> {
    if (!force && !isStale(this.inboxRefreshAt, creds.applierName)) return true;
    const { messages } = await this.imap.fetchMailboxWindow(
      creds.email,
      creds.password,
      'inbox',
      creds.applierName,
      IMAP_MAX_FOLDER_ENVELOPES,
    );
    if (messages.length) await this.cache.upsertMessages(messages);
    this.inboxRefreshAt.set(creds.applierName, Date.now());
    return true;
  }

  /**
   * All Mail stats: labels-only for counts, envelopes for the visible page.
   */
  async loadStatsPage(
    creds: MailCredentialsOk,
    opts: {
      since?: Date;
      before?: Date;
      selected?: string[];
      page?: number;
      pageSize?: number;
      force?: boolean;
    } = {},
  ) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const selected = opts.selected || [];
    const key = `${creds.applierName}:${opts.since?.toISOString() || ''}:${opts.before?.toISOString() || ''}`;
    const cached = this.statsScan.get(key);
    if (
      !opts.force &&
      cached &&
      Date.now() - cached.at < MAIL_IMAP_REFRESH_STALE_MS
    ) {
      const stats = statsFromLabelRows(cached.rows, selected);
      const start = (page - 1) * pageSize;
      const pageUids = stats.matching
        .slice(start, start + pageSize)
        .map((row) => row.uid);
      const messages = await this.imap.fetchEnvelopesByUids(
        creds.email,
        creds.password,
        ALL_MAIL_PATH,
        pageUids,
        creds.applierName,
      );
      if (messages.length) this.cacheInBackground(messages);
      return { ...stats.summary, messages };
    }

    const live = await this.imap.fetchAllMailStatsPage(
      creds.email,
      creds.password,
      creds.applierName,
      {
        since: opts.since,
        before: opts.before,
        selected,
        page,
        pageSize,
        max: IMAP_MAX_STATS_ENVELOPES,
      },
    );
    this.statsScan.set(key, { at: Date.now(), rows: live.allRows });
    this.statsRefreshAt.set(key, Date.now());
    if (live.messages.length) this.cacheInBackground(live.messages);
    return {
      total: live.total,
      unlabeled: live.unlabeled,
      labeled: live.labeled,
      byLabel: live.byLabel,
      messages: live.messages,
    };
  }

  /**
   * Pull All Mail envelopes for a date window from Gmail, then stats can read
   * the cache. Mongo is the index, not the source of truth.
   */
  async refreshStatsWindow(
    creds: MailCredentialsOk,
    opts: { since?: Date; before?: Date; force?: boolean } = {},
  ): Promise<boolean> {
    const key = `${creds.applierName}:${opts.since?.toISOString() || ''}:${opts.before?.toISOString() || ''}`;
    if (!opts.force && !isStale(this.statsRefreshAt, key)) return true;
    const messages = await this.imap.fetchAllMailWindow(
      creds.email,
      creds.password,
      creds.applierName,
      {
        since: opts.since,
        before: opts.before,
        max: IMAP_MAX_STATS_ENVELOPES,
      },
    );
    if (messages.length) await this.cache.upsertMessages(messages);
    this.statsRefreshAt.set(key, Date.now());
    return true;
  }

  async syncInitial(
    creds: MailCredentialsOk,
    opts: { folder?: string; page?: number; pageSize?: number } = {},
  ) {
    const folder = opts.folder || 'inbox';
    const page = opts.page || 1;
    const pageSize = opts.pageSize || 25;
    const { messages, total, mailbox } = await this.imap.fetchMailboxPage(
      creds.email,
      creds.password,
      folder,
      page,
      pageSize,
      creds.applierName,
    );
    if (messages.length) {
      await this.cache.upsertMessages(messages);
      // Deliberately not touching highestUid/lowestUid: those track
      // `[Gmail]/All Mail` for syncIncremental, and IMAP UIDs are per mailbox.
      // Writing this folder's UIDs there rewound the incremental cursor, so new
      // mail was only picked up IMAP_MAX_NEW_ENVELOPES at a time from an old UID.
      await this.cache.upsertSyncState(creds.applierName, {
        lastSyncAt: new Date(),
      });
    }
    return { messages, total, page, pageSize, mailbox };
  }

  async refreshLabels(creds: MailCredentialsOk) {
    const labels = await this.imap.fetchGmailLabelList(
      creds.email,
      creds.password,
    );
    await this.cache.upsertSyncState(creds.applierName, {
      gmailLabelsJson: labels,
    });
    return labels;
  }

  async refreshFolderCounts(creds: MailCredentialsOk, force = false) {
    const state = await this.cache.getSyncState(creds.applierName);
    if (
      !force &&
      state?.folderCountsJson &&
      state.lastSyncAt &&
      Date.now() - state.lastSyncAt.getTime() < 60_000
    ) {
      return {
        counts: state.folderCountsJson as Record<
          string,
          { total: number; unread: number; badge: number }
        >,
        cached: true,
      };
    }
    const counts = await this.imap.fetchFolderCounts(
      creds.email,
      creds.password,
    );
    await this.cache.upsertSyncState(creds.applierName, {
      folderCountsJson: counts,
    });
    return { counts, cached: false };
  }

  /** Custom Gmail label paths from last Mail sync; IMAP LIST only if cache is empty. */
  async allowedCustomLabelNames(creds: MailCredentialsOk): Promise<string[]> {
    const state = await this.cache.getSyncState(creds.applierName);
    const cached = labelNamesFromCache(state?.gmailLabelsJson);
    if (cached.length) return cached;
    const labels = await this.refreshLabels(creds);
    return labels.map((label) => label.path || label.name).filter(Boolean);
  }

  private async ensureUnlabeledScan(
    creds: MailCredentialsOk,
    force: boolean,
  ): Promise<UnlabeledScanCache> {
    const cached = freshUnlabeledScan(
      this.unlabeledScan.get(creds.applierName),
    );
    if (!force && cached) return cached;
    const waiting = this.unlabeledWait.get(creds.applierName);
    if (waiting) return waiting;
    const pending = this.imap
      .scanUnlabeledInbox(creds.email, creds.password)
      .then((scan) => {
        const row: UnlabeledScanCache = {
          at: Date.now(),
          uids: scan.unlabeledUids,
          mailboxTotal: scan.mailboxTotal,
        };
        this.unlabeledScan.set(creds.applierName, row);
        this.unlabeledWait.delete(creds.applierName);
        return row;
      })
      .catch((err) => {
        this.unlabeledWait.delete(creds.applierName);
        throw err;
      });
    this.unlabeledWait.set(creds.applierName, pending);
    return pending;
  }

  private async envelopesForUnlabeledPage(
    creds: MailCredentialsOk,
    scan: UnlabeledScanCache,
    page: number,
    pageSize: number,
  ) {
    const start = (page - 1) * pageSize;
    const pageUids = scan.uids.slice(start, start + pageSize);
    const messages = await this.imap.fetchEnvelopesByUids(
      creds.email,
      creds.password,
      'INBOX',
      pageUids,
      creds.applierName,
    );
    if (messages.length) this.cacheInBackground(messages);
    return {
      messages,
      unlabeledTotal: scan.uids.length,
      page,
      pageSize,
    };
  }
}

function freshUnlabeledScan(
  cached: UnlabeledScanCache | undefined,
): UnlabeledScanCache | null {
  if (!cached) return null;
  if (Date.now() - cached.at >= MAIL_IMAP_REFRESH_STALE_MS) return null;
  return cached;
}

function isStale(times: Map<string, number>, key: string): boolean {
  const at = times.get(key) || 0;
  return Date.now() - at >= MAIL_IMAP_REFRESH_STALE_MS;
}

function labelNamesFromCache(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { path?: unknown; name?: unknown };
    const raw = row.path ?? row.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name) names.push(name);
  }
  return names;
}
