import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ALL_MAIL_PATH } from './constants/mail.constants';
import { ImapClientService } from './imap/imap-client.service';
import { MailAiLabelService } from './mail-ai-label.service';
import { MailAiWriteService } from './mail-ai-write.service';
import { MailCacheService } from './mail-cache.service';
import { MailCredentialsService } from './mail-credentials.service';
import { MailLabelDefinitionsService } from './mail-label-definitions.service';
import { MailSyncService } from './mail-sync.service';
import { messageToThread } from './mappers/mail-thread.mapper';
import { SmtpClientService } from './smtp/smtp-client.service';
import { extractCustomLabels } from './mappers/folder-mapper';

@Injectable()
export class MailService {
  constructor(
    private readonly credentials: MailCredentialsService,
    private readonly imap: ImapClientService,
    private readonly smtp: SmtpClientService,
    private readonly cache: MailCacheService,
    private readonly syncService: MailSyncService,
    private readonly definitions: MailLabelDefinitionsService,
    private readonly aiWriteService: MailAiWriteService,
    private readonly aiLabel: MailAiLabelService,
  ) {}

  private async requireCreds(applierName: string) {
    const creds = await this.credentials.resolve(applierName);
    if (!creds.ok) throw new BadRequestException(creds.error);
    return creds;
  }

  private requireBeta(tier: string | null) {
    if (!this.credentials.isBeta(tier)) {
      throw new ForbiddenException(
        'Beta access required for this mail feature.',
      );
    }
  }

  async credentialsStatus(applierName: string) {
    const creds = await this.credentials.resolve(applierName);
    if (!creds.ok) {
      return { success: true, configured: false, error: creds.error };
    }
    return { success: true, configured: true, email: creds.email };
  }

  async listThreads(query: {
    applierName: string;
    folder?: string;
    label?: string;
    search?: string;
    unlabeled?: boolean;
    page?: number;
    pageSize?: number;
    cacheOnly?: boolean;
    force?: boolean;
  }) {
    const creds = await this.requireCreds(query.applierName);
    const folder = query.folder || 'inbox';
    const page = query.page || 1;
    const pageSize = query.pageSize || 25;

    if (query.unlabeled && !query.cacheOnly) {
      try {
        const live = await this.syncService.fetchUnlabeledPage(creds, {
          page,
          pageSize,
          force: query.force,
        });
        return {
          success: true,
          threads: live.messages.map((row) =>
            messageToThread(row, { includeBody: false }),
          ),
          total: live.unlabeledTotal,
          totalExact: true,
          hasMore: page * pageSize < live.unlabeledTotal,
          page: live.page,
          pageSize: live.pageSize,
          fromCache: false,
        };
      } catch {
        /* fall back to cache */
      }
    } else if (!query.cacheOnly) {
      try {
        if (query.force || page === 1) {
          await this.syncService.syncInitial(creds, { folder, page, pageSize });
        }
      } catch {
        /* fall back to cache */
      }
    }

    const listed = await this.cache.listMessages(creds.applierName, {
      folder: query.unlabeled ? 'inbox' : folder,
      mailbox: query.unlabeled ? 'INBOX' : undefined,
      label: query.label,
      search: query.search,
      unlabeled: query.unlabeled,
      page,
      pageSize,
    });

    return {
      success: true,
      threads: listed.rows.map((row) =>
        messageToThread(row, { includeBody: false }),
      ),
      total: listed.total,
      totalExact: true,
      hasMore: listed.hasMore,
      page: listed.page,
      pageSize: listed.pageSize,
      fromCache: true,
    };
  }

  async getMessage(applierName: string, uidRaw: string, folder?: string) {
    const creds = await this.requireCreds(applierName);
    const uid = Number(uidRaw);
    if (!Number.isFinite(uid)) {
      throw new BadRequestException('Invalid message uid');
    }
    let doc = await this.cache.getMessage(creds.applierName, uid);
    const mailbox =
      doc?.mailbox || (folder ? undefined : ALL_MAIL_PATH) || ALL_MAIL_PATH;

    if (!doc?.hasBody) {
      const body = await this.imap.fetchMessageBody(
        creds.email,
        creds.password,
        uid,
        doc?.mailbox || mailbox,
      );
      if (!doc) {
        const env = await this.imap.fetchEnvelopeForUid(
          creds.email,
          creds.password,
          uid,
          creds.applierName,
          mailbox,
        );
        if (env) {
          env.bodyText = body.bodyText;
          env.bodyHtml = body.bodyHtml;
          env.preview = body.preview || env.preview;
          env.hasBody = true;
          await this.cache.upsertMessages([env]);
          doc = await this.cache.getMessage(creds.applierName, uid, mailbox);
        }
      } else {
        await this.cache.updateMessageBody(
          creds.applierName,
          uid,
          body,
          doc.mailbox,
        );
        doc = await this.cache.getMessage(creds.applierName, uid, doc.mailbox);
      }
    }

    if (!doc) throw new NotFoundException('Message not found');
    return {
      success: true,
      thread: messageToThread(doc, { includeBody: true }),
      fromCache: Boolean(doc.hasBody),
    };
  }

  /** Inbox mail with no custom Gmail label — labels-only Gmail scan. */
  async unlabeledCount(applierName: string, force = false) {
    const creds = await this.requireCreds(applierName);
    try {
      const total = await this.syncService.countUnlabeledInbox(creds, force);
      return { success: true, total };
    } catch {
      const total = await this.cache.countUnlabeled(creds.applierName, 'INBOX');
      return { success: true, total };
    }
  }

  async folderCounts(applierName: string, force = false) {
    const creds = await this.requireCreds(applierName);
    const { counts, cached } = await this.syncService.refreshFolderCounts(
      creds,
      force,
    );
    return { success: true, counts, cached };
  }

  async sync(applierName: string) {
    const creds = await this.requireCreds(applierName);
    const result = await this.syncService.syncIncremental(creds);
    return { success: true, ...result };
  }

  async syncInitial(
    applierName: string,
    folder?: string,
    page?: number,
    pageSize?: number,
  ) {
    const creds = await this.requireCreds(applierName);
    const result = await this.syncService.syncInitial(creds, {
      folder,
      page,
      pageSize,
    });
    return {
      success: true,
      threads: result.messages.map((m) =>
        messageToThread(
          {
            ...m,
            fromName: m.from.name,
            fromEmail: m.from.email,
            seen: m.flags.seen,
            flagged: m.flags.flagged,
          },
          { includeBody: false },
        ),
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async syncOlder() {
    return {
      success: true,
      newCount: 0,
      hasMore: false,
      message: 'Use page navigation instead',
    };
  }

  async send(
    applierName: string,
    body: {
      to: string;
      subject: string;
      body: string;
      replyToUid?: string;
      sourceFolder?: string;
    },
  ) {
    const creds = await this.requireCreds(applierName);
    const result = await this.smtp.sendMail({
      email: creds.email,
      password: creds.password,
      to: body.to,
      subject: body.subject,
      body: body.body,
    });
    return { success: true, messageId: result.messageId };
  }

  async patchMessage(
    applierName: string,
    uidRaw: string,
    patch: {
      seen?: boolean;
      flagged?: boolean;
      folder?: string;
      addLabels?: string[];
      removeLabels?: string[];
      sourceFolder?: string;
    },
  ) {
    const creds = await this.requireCreds(applierName);
    const uid = Number(uidRaw);
    if (!Number.isFinite(uid))
      throw new BadRequestException('Invalid message uid');
    const doc = await this.cache.getMessage(creds.applierName, uid);
    const mailbox = doc?.mailbox || ALL_MAIL_PATH;

    if (typeof patch.seen === 'boolean') {
      await this.imap.setMessageSeen(
        creds.email,
        creds.password,
        uid,
        patch.seen,
        mailbox,
      );
    }
    if (typeof patch.flagged === 'boolean') {
      await this.imap.setMessageFlagged(
        creds.email,
        creds.password,
        uid,
        patch.flagged,
        mailbox,
      );
    }
    if (patch.folder === 'trash') {
      await this.imap.trashMessage(creds.email, creds.password, uid, mailbox);
    } else if (patch.folder === 'archive') {
      await this.imap.archiveMessage(creds.email, creds.password, uid, mailbox);
    } else if (patch.folder === 'inbox') {
      await this.imap.moveToInbox(creds.email, creds.password, uid, mailbox);
    }
    if (patch.addLabels?.length) {
      await this.imap.addLabelsToMessages(
        creds.email,
        creds.password,
        [uid],
        patch.addLabels,
        mailbox,
      );
    }
    if (patch.removeLabels?.length) {
      await this.imap.removeLabelsFromMessage(
        creds.email,
        creds.password,
        uid,
        patch.removeLabels,
        mailbox,
      );
    }

    let gmailLabels = doc?.gmailLabels || [];
    if (patch.addLabels?.length) {
      gmailLabels = [...new Set([...gmailLabels, ...patch.addLabels])];
    }
    if (patch.removeLabels?.length) {
      const remove = new Set(patch.removeLabels.map((l) => l.toLowerCase()));
      gmailLabels = gmailLabels.filter((l) => !remove.has(l.toLowerCase()));
    }

    await this.cache.updateMessageFlags(
      creds.applierName,
      uid,
      {
        seen: patch.seen,
        flagged: patch.flagged,
        folder: patch.folder,
        gmailLabels,
        labels: extractCustomLabels(gmailLabels),
      },
      mailbox,
    );

    const updated = await this.cache.getMessage(
      creds.applierName,
      uid,
      mailbox,
    );
    if (!updated) throw new NotFoundException('Message not found');
    return {
      success: true,
      thread: messageToThread(updated, {
        includeBody: Boolean(updated.hasBody),
      }),
    };
  }

  async listLabels(applierName: string) {
    const creds = await this.requireCreds(applierName);
    try {
      const labels = await this.syncService.refreshLabels(creds);
      return { success: true, labels, cached: false };
    } catch {
      const state = await this.cache.getSyncState(creds.applierName);
      const labels = Array.isArray(state?.gmailLabelsJson)
        ? state.gmailLabelsJson
        : [];
      return { success: true, labels, cached: true, stale: true };
    }
  }

  async createLabel(applierName: string, name: string, parentId?: string) {
    const creds = await this.requireCreds(applierName);
    let parentPath: string | undefined;
    if (parentId) {
      const labels = await this.imap.fetchGmailLabelList(
        creds.email,
        creds.password,
      );
      parentPath = labels.find((l) => l.id === parentId)?.path;
    }
    const label = await this.imap.createGmailLabel(
      creds.email,
      creds.password,
      name,
      parentPath,
    );
    await this.syncService.refreshLabels(creds);
    return { success: true, label };
  }

  async deleteLabel(applierName: string, labelId: string) {
    const creds = await this.requireCreds(applierName);
    const labels = await this.imap.fetchGmailLabelList(
      creds.email,
      creds.password,
    );
    const match =
      labels.find((l) => l.id === labelId) ||
      labels.find((l) => l.path === labelId) ||
      labels.find((l) => l.name === labelId);
    if (!match) throw new NotFoundException('Label not found');
    const result = await this.imap.deleteGmailLabel(
      creds.email,
      creds.password,
      match.path,
    );
    await this.syncService.refreshLabels(creds);
    return { success: true, ...result };
  }

  async getDefinitions(applierName: string) {
    const creds = await this.requireCreds(applierName);
    this.requireBeta(creds.tier);
    const definitions = await this.definitions.get(creds.applierName);
    return { success: true, definitions };
  }

  async saveDefinitions(
    applierName: string,
    definitions: Record<string, string>,
  ) {
    const creds = await this.requireCreds(applierName);
    this.requireBeta(creds.tier);
    const saved = await this.definitions.save(creds.applierName, definitions);
    return { success: true, definitions: saved };
  }

  async aiWrite(
    applierName: string,
    payload: {
      mode: 'write' | 'fine-tune' | 'reply';
      prompt?: string;
      body?: string;
      subject?: string;
      replyContext?: string;
    },
  ) {
    const creds = await this.requireCreds(applierName);
    this.requireBeta(creds.tier);
    const result = await this.aiWriteService.write({
      applierName: creds.applierName,
      ...payload,
    });
    return { success: true, ...result };
  }

  /** Used by background-tasks processor. */
  getAiLabelService() {
    return this.aiLabel;
  }

  getCredentialsService() {
    return this.credentials;
  }
}
