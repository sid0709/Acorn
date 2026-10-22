import { Injectable, Logger } from '@nestjs/common';
import { MAIL_AI_LABEL_BODY_MAX_CHARS } from '../ai/constants/ai-concurrency.constants';
import { ImapClientService } from './imap/imap-client.service';
import {
  logMailAiLabel,
  parseMessageId,
  type MailAiLabelLoaded,
  type MailAiLabelResult,
} from './mail-ai-label.parse';
import { MailCacheService } from './mail-cache.service';
import type { MailCredentialsOk } from './mail-credentials.service';

@Injectable()
export class MailAiLabelLoadService {
  private readonly logger = new Logger(MailAiLabelLoadService.name);

  constructor(
    private readonly imap: ImapClientService,
    private readonly cache: MailCacheService,
  ) {}

  async loadEmails(
    creds: MailCredentialsOk,
    messageIds: string[],
  ): Promise<{
    emails: MailAiLabelLoaded[];
    loadFailed: Array<{ id: string; result: MailAiLabelResult }>;
  }> {
    const rows = await Promise.all(
      messageIds.map((id) => this.loadOne(creds, id)),
    );
    const emails: MailAiLabelLoaded[] = [];
    const loadFailed: Array<{ id: string; result: MailAiLabelResult }> = [];
    for (const row of rows) {
      if (row.email) emails.push(row.email);
      else if (row.failed) loadFailed.push({ id: row.id, result: row.failed });
    }
    const invalidIds = loadFailed.filter(
      (row) => row.result.error === 'Invalid message id',
    ).length;
    const missing = loadFailed.filter(
      (row) => row.result.error === 'Message not found',
    ).length;
    logMailAiLabel(this.logger, 'gmail_load', {
      ids: messageIds.length,
      loaded: emails.length,
      failed: loadFailed.length,
      invalidIds,
      missing,
      firstError: loadFailed[0]?.result.error || 'none',
    });
    return { emails, loadFailed };
  }

  async fillBodies(
    creds: MailCredentialsOk,
    emails: MailAiLabelLoaded[],
  ): Promise<number> {
    const missing = emails.filter((email) => !email.bodyText);
    if (!missing.length) {
      logMailAiLabel(this.logger, 'gmail_bodies', {
        missing: 0,
        cached: emails.length,
      });
      return 0;
    }
    const byMailbox = new Map<string, MailAiLabelLoaded[]>();
    for (const email of missing) {
      const list = byMailbox.get(email.mailbox) || [];
      list.push(email);
      byMailbox.set(email.mailbox, list);
    }
    const started = Date.now();
    logMailAiLabel(this.logger, 'gmail_bodies_start', {
      missing: missing.length,
      mailboxes: byMailbox.size,
    });
    await Promise.all(
      [...byMailbox.entries()].map(async ([mailbox, rows]) => {
        const fetched = await this.imap.fetchTextBodiesByUid(
          creds.email,
          creds.password,
          mailbox,
          rows.map((row) => row.uid),
          MAIL_AI_LABEL_BODY_MAX_CHARS * 8,
        );
        const textByUid = new Map(
          fetched.map((row) => [row.uid, String(row.bodyText || '').trim()]),
        );
        await Promise.all(
          rows.map(async (row) => {
            const text = textByUid.get(row.uid) || '';
            row.bodyText = text;
            if (!text) return;
            await this.cache.updateMessageBody(
              creds.applierName,
              row.uid,
              {
                bodyText: text,
                bodyHtml: null,
                preview: text.slice(0, 120) || row.preview,
              },
              row.mailbox,
            );
          }),
        );
      }),
    );
    const emptyAfter = emails.filter((email) => !email.bodyText).length;
    logMailAiLabel(this.logger, 'gmail_bodies_done', {
      fetched: missing.length,
      emptyAfter,
      ms: Date.now() - started,
    });
    return missing.length;
  }

  private async loadOne(
    creds: MailCredentialsOk,
    id: string,
  ): Promise<{
    id: string;
    email?: MailAiLabelLoaded;
    failed?: MailAiLabelResult;
  }> {
    const { mailbox, uid, explicitMailbox } = parseMessageId(id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return {
        id,
        failed: {
          id,
          uid: Number.isFinite(uid) ? uid : 0,
          label: null,
          applied: false,
          reason: 'body_error',
          error: 'Invalid message id',
        },
      };
    }
    // A bare uid is ambiguous because UIDs are per mailbox, so look the row up
    // without one and trust the mailbox it was cached under.
    let cached = explicitMailbox
      ? await this.cache.getMessage(creds.applierName, uid, mailbox)
      : await this.cache.getMessage(creds.applierName, uid);
    if (!cached) {
      const env = await this.imap.fetchEnvelopeForUid(
        creds.email,
        creds.password,
        uid,
        creds.applierName,
        mailbox,
      );
      if (env) {
        await this.cache.upsertMessages([env]);
        cached = await this.cache.getMessage(creds.applierName, uid, mailbox);
      }
    }
    if (!cached) {
      return {
        id,
        failed: {
          id,
          uid,
          label: null,
          applied: false,
          reason: 'body_error',
          error: 'Message not found',
        },
      };
    }
    return {
      id,
      email: {
        id,
        mailbox: cached.mailbox || mailbox,
        uid,
        from: cached.fromName || cached.fromEmail || '',
        subject: cached.subject,
        preview: cached.preview || '',
        bodyText: String(cached.bodyText || '').trim(),
        gmailLabels: cached.gmailLabels || [],
      },
    };
  }
}
