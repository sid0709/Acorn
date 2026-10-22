import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_MAIL_PATH } from './constants/mail.constants';
import {
  extractCustomLabels,
  labelsMatchFilter,
  type MailMessageDoc,
} from './mappers/folder-mapper';

/** Must match @@map on MailMessage / MailSyncState. */
const MAIL_MESSAGES = 'mail_messages';
const MAIL_SYNC_STATE = 'mail_sync_state';

@Injectable()
export class MailCacheService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMessages(messages: MailMessageDoc[]) {
    if (!messages.length) return;
    try {
      await this.bulkUpsertMessages(messages);
      return;
    } catch {
      /* sequential fallback below */
    }
    for (const m of messages) {
      const key = {
        applierName: m.applierName,
        mailbox: m.mailbox,
        uid: m.uid,
      };
      const create = {
        ...key,
        messageId: m.messageId,
        fromName: m.from.name,
        fromEmail: m.from.email,
        toJson: m.to as unknown as Prisma.InputJsonValue,
        ccJson: m.cc as unknown as Prisma.InputJsonValue,
        subject: m.subject,
        preview: m.preview,
        bodyText: m.bodyText || null,
        bodyHtml: m.bodyHtml,
        date: m.date,
        seen: m.flags.seen,
        flagged: m.flags.flagged,
        gmailLabels: m.gmailLabels,
        folder: m.folder,
        labels: m.labels,
        hasBody: m.hasBody,
        syncedAt: m.syncedAt,
      };
      const update = {
        messageId: m.messageId,
        fromName: m.from.name,
        fromEmail: m.from.email,
        toJson: m.to as unknown as Prisma.InputJsonValue,
        ccJson: m.cc as unknown as Prisma.InputJsonValue,
        subject: m.subject,
        preview: m.preview || undefined,
        date: m.date,
        seen: m.flags.seen,
        flagged: m.flags.flagged,
        gmailLabels: m.gmailLabels,
        folder: m.folder,
        labels: m.labels,
        syncedAt: m.syncedAt,
      };

      const existing = await this.prisma.mailMessage.findUnique({
        where: { applierName_mailbox_uid: key },
      });
      if (existing) {
        await this.updateMessageDoc(existing.id, key, update);
      } else {
        await this.createMessageDoc(key, create, update);
      }
    }
  }

  private async bulkUpsertMessages(messages: MailMessageDoc[]) {
    const updates = messages.map((m) => ({
      q: { applierName: m.applierName, mailbox: m.mailbox, uid: m.uid },
      u: {
        $set: toMongoDoc({
          messageId: m.messageId,
          fromName: m.from.name,
          fromEmail: m.from.email,
          toJson: m.to,
          ccJson: m.cc,
          subject: m.subject,
          preview: m.preview,
          date: m.date,
          seen: m.flags.seen,
          flagged: m.flags.flagged,
          gmailLabels: m.gmailLabels,
          folder: m.folder,
          labels: m.labels,
          syncedAt: m.syncedAt,
          updatedAt: new Date(),
        }),
        $setOnInsert: toMongoDoc({
          bodyText: m.bodyText || null,
          bodyHtml: m.bodyHtml,
          hasBody: m.hasBody,
        }),
      },
      upsert: true,
      multi: false,
    }));
    await this.prisma.$runCommandRaw({
      update: MAIL_MESSAGES,
      updates,
      ordered: false,
    } as unknown as Prisma.InputJsonObject);
  }

  async updateMessageBody(
    applierName: string,
    uid: number,
    patch: { bodyText: string; bodyHtml: string | null; preview: string },
    mailbox = ALL_MAIL_PATH,
  ) {
    const data = {
      bodyText: patch.bodyText,
      bodyHtml: patch.bodyHtml,
      preview: patch.preview || undefined,
      hasBody: true,
    };
    try {
      await this.prisma.mailMessage.updateMany({
        where: { applierName, mailbox, uid },
        data,
      });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await this.rawUpdate(MAIL_MESSAGES, { applierName, mailbox, uid }, data);
    }
  }

  async updateMessageFlags(
    applierName: string,
    uid: number,
    patch: {
      seen?: boolean;
      flagged?: boolean;
      folder?: string;
      gmailLabels?: string[];
      labels?: string[];
    },
    mailbox = ALL_MAIL_PATH,
  ) {
    const data: Prisma.MailMessageUpdateManyMutationInput = {};
    if (typeof patch.seen === 'boolean') data.seen = patch.seen;
    if (typeof patch.flagged === 'boolean') data.flagged = patch.flagged;
    if (patch.folder) data.folder = patch.folder;
    if (patch.gmailLabels) {
      data.gmailLabels = patch.gmailLabels;
      data.labels = extractCustomLabels(patch.gmailLabels);
    }
    if (patch.labels) data.labels = patch.labels;
    if (Object.keys(data).length === 0) return;
    try {
      await this.prisma.mailMessage.updateMany({
        where: { applierName, mailbox, uid },
        data,
      });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await this.rawUpdate(MAIL_MESSAGES, { applierName, mailbox, uid }, data);
    }
  }

  async getMessage(applierName: string, uid: number, mailbox?: string) {
    if (mailbox) {
      return this.prisma.mailMessage.findUnique({
        where: {
          applierName_mailbox_uid: { applierName, mailbox, uid },
        },
      });
    }
    return this.prisma.mailMessage.findFirst({
      where: { applierName, uid },
      orderBy: { syncedAt: 'desc' },
    });
  }

  async listMessages(
    applierName: string,
    opts: {
      folder?: string;
      label?: string;
      search?: string;
      unlabeled?: boolean;
      page?: number;
      pageSize?: number;
      mailbox?: string;
    } = {},
  ) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const where: Prisma.MailMessageWhereInput = { applierName };
    if (opts.mailbox) where.mailbox = opts.mailbox;
    if (opts.folder && opts.folder !== 'all') where.folder = opts.folder;
    if (opts.search?.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { fromName: { contains: q, mode: 'insensitive' } },
        { fromEmail: { contains: q, mode: 'insensitive' } },
        { preview: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (opts.unlabeled) {
      where.folder = 'inbox';
      where.mailbox = opts.mailbox || 'INBOX';
      return this.listUnlabeled(where, page, pageSize);
    }

    let rows = await this.prisma.mailMessage.findMany({
      where,
      orderBy: { date: 'desc' },
      take: opts.label ? 500 : pageSize,
      skip: opts.label ? 0 : (page - 1) * pageSize,
    });

    if (opts.label) {
      rows = rows.filter((r) => labelsMatchFilter(r.gmailLabels, opts.label));
      const total = rows.length;
      const start = (page - 1) * pageSize;
      rows = rows.slice(start, start + pageSize);
      return {
        rows,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      };
    }

    const total = await this.prisma.mailMessage.count({ where });
    return { rows, total, page, pageSize, hasMore: page * pageSize < total };
  }

  /** Inbox mail carrying no custom Gmail label. */
  async countUnlabeled(
    applierName: string,
    mailbox = 'INBOX',
  ): Promise<number> {
    return this.prisma.mailMessage.count({
      where: unlabeledWhere({ applierName, mailbox }),
    });
  }

  /**
   * `labels` is the materialized projection of `gmailLabels`, so it is the one
   * source of truth for "unlabeled" and count/rows/hasMore always agree.
   * Rows written before that projection existed can drift, so repair them and
   * re-read once instead of filtering them out of a single page.
   */
  private async listUnlabeled(
    where: Prisma.MailMessageWhereInput,
    page: number,
    pageSize: number,
  ) {
    const query = unlabeledWhere(where);
    const read = async () => {
      const total = await this.prisma.mailMessage.count({ where: query });
      const rows = await this.prisma.mailMessage.findMany({
        where: query,
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { total, rows };
    };

    let { total, rows } = await read();
    if (await this.repairDriftedLabels(rows)) {
      ({ total, rows } = await read());
    }
    return { rows, total, page, pageSize, hasMore: page * pageSize < total };
  }

  /** Returns true when any row's `labels` disagreed with `gmailLabels`. */
  private async repairDriftedLabels(
    rows: Array<{ id: string; gmailLabels: string[]; labels: string[] }>,
  ): Promise<boolean> {
    const drifted = rows.filter((row) => {
      const derived = extractCustomLabels(row.gmailLabels);
      return derived.length !== row.labels.length;
    });
    if (!drifted.length) return false;
    await Promise.all(
      drifted.map((row) =>
        this.prisma.mailMessage.update({
          where: { id: row.id },
          data: { labels: extractCustomLabels(row.gmailLabels) },
        }),
      ),
    );
    return true;
  }

  async getSyncState(applierName: string) {
    return this.prisma.mailSyncState.findUnique({ where: { applierName } });
  }

  async upsertSyncState(
    applierName: string,
    patch: {
      highestUid?: number;
      lowestUid?: number;
      lastSyncAt?: Date;
      syncing?: boolean;
      gmailLabelsJson?: Prisma.InputJsonValue;
      folderCountsJson?: Prisma.InputJsonValue;
    },
  ) {
    const create = {
      applierName,
      highestUid: patch.highestUid ?? 0,
      lowestUid: patch.lowestUid ?? 0,
      lastSyncAt: patch.lastSyncAt ?? null,
      syncing: patch.syncing ?? false,
      gmailLabelsJson: patch.gmailLabelsJson ?? null,
      folderCountsJson: patch.folderCountsJson ?? null,
    };
    const update = omitUndefined({
      highestUid: patch.highestUid,
      lowestUid: patch.lowestUid,
      lastSyncAt: patch.lastSyncAt,
      syncing: patch.syncing,
      gmailLabelsJson: patch.gmailLabelsJson,
      folderCountsJson: patch.folderCountsJson,
    });

    const existing = await this.prisma.mailSyncState.findUnique({
      where: { applierName },
    });
    if (existing) {
      try {
        return await this.prisma.mailSyncState.update({
          where: { id: existing.id },
          data: update,
        });
      } catch (error) {
        if (!isReplicaSetRequired(error)) throw error;
        await this.rawUpdate(
          MAIL_SYNC_STATE,
          { _id: { $oid: existing.id } },
          update,
        );
        const row = await this.getSyncState(applierName);
        if (!row) throw new Error('Failed to load updated mail sync state');
        return row;
      }
    }

    try {
      return await this.prisma.mailSyncState.create({ data: create });
    } catch (error) {
      if (isUniqueConflict(error)) {
        try {
          return await this.prisma.mailSyncState.update({
            where: { applierName },
            data: update,
          });
        } catch (updateError) {
          if (!isReplicaSetRequired(updateError)) throw updateError;
          await this.rawUpdate(MAIL_SYNC_STATE, { applierName }, update);
          const row = await this.getSyncState(applierName);
          if (!row) throw new Error('Failed to load updated mail sync state');
          return row;
        }
      }
      if (!isReplicaSetRequired(error)) throw error;
      await this.rawInsert(MAIL_SYNC_STATE, create);
      const row = await this.getSyncState(applierName);
      if (!row) throw new Error('Failed to load created mail sync state');
      return row;
    }
  }

  private async createMessageDoc(
    key: { applierName: string; mailbox: string; uid: number },
    create: Record<string, unknown>,
    update: Record<string, unknown>,
  ) {
    try {
      await this.prisma.mailMessage.create({
        data: create as Prisma.MailMessageCreateInput,
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        await this.prisma.mailMessage.update({
          where: { applierName_mailbox_uid: key },
          data: update,
        });
        return;
      }
      if (!isReplicaSetRequired(error)) throw error;
      try {
        await this.rawInsert(MAIL_MESSAGES, create);
      } catch (rawError) {
        if (!isDuplicateKey(rawError)) throw rawError;
        await this.rawUpdate(MAIL_MESSAGES, key, update);
      }
    }
  }

  private async updateMessageDoc(
    id: string,
    key: { applierName: string; mailbox: string; uid: number },
    update: Record<string, unknown>,
  ) {
    try {
      await this.prisma.mailMessage.update({
        where: { id },
        data: update,
      });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await this.rawUpdate(MAIL_MESSAGES, key, update);
    }
  }

  private async rawInsert(collection: string, data: Record<string, unknown>) {
    await this.prisma.$runCommandRaw({
      insert: collection,
      documents: [
        toMongoDoc({ ...omitUndefined(data), updatedAt: new Date() }),
      ],
      ordered: true,
    } as unknown as Prisma.InputJsonObject);
  }

  private async rawUpdate(
    collection: string,
    query: Record<string, unknown>,
    data: Record<string, unknown>,
  ) {
    const set = toMongoDoc({
      ...omitUndefined(data),
      updatedAt: new Date(),
    });
    await this.prisma.$runCommandRaw({
      update: collection,
      updates: [{ q: query, u: { $set: set }, multi: false }],
    } as unknown as Prisma.InputJsonObject);
  }
}

/** The one definition of "unlabeled", shared by the listing and the count. */
function unlabeledWhere(
  base: Prisma.MailMessageWhereInput,
): Prisma.MailMessageWhereInput {
  return { ...base, folder: 'inbox', labels: { equals: [] } };
}

function omitUndefined(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Prisma $runCommandRaw JSON must use Extended JSON for BSON dates. */
function toMongoDoc(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Date) {
      out[k] = { $date: v.toISOString() };
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isReplicaSetRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /replica set/i.test(message);
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function isDuplicateKey(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /E11000|duplicate key/i.test(message) || isUniqueConflict(error);
}
