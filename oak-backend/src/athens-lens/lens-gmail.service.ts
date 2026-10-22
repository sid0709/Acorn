import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ImapClientService } from '../mail/imap/imap-client.service';
import { MailCredentialsService } from '../mail/mail-credentials.service';
import {
  mapLensGmailEnvelope,
  mapLensGmailMessage,
} from './mappers/lens-gmail.mapper';

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 40;
const MAX_BODY_BATCH_SIZE = 8;
/** Gmail label mailbox used by Athens Lens (IMAP folder path). */
const ATHENS_LENS_GMAIL_LABEL = 'Notify/Unnecessary';

@Injectable()
export class LensGmailService {
  constructor(
    private readonly credentials: MailCredentialsService,
    private readonly imap: ImapClientService,
  ) {}

  async listMessages(
    applierName: string,
    opts: { page?: number; pageSize?: number; label?: string },
  ) {
    const creds = await this.requireCreds(applierName);
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, Number(opts.pageSize) || DEFAULT_PAGE_SIZE),
    );
    const label = String(opts.label || '').trim() || ATHENS_LENS_GMAIL_LABEL;

    try {
      const live = await this.imap.fetchLabelMailboxEnvelopes(
        creds.email,
        creds.password,
        label,
        { page, pageSize },
      );
      const messages = (live.messages || [])
        .map(mapLensGmailEnvelope)
        .filter((message) => message.id);

      return {
        success: true as const,
        accountEmail: creds.email,
        label,
        page,
        pageSize,
        hasMore: Boolean(live.hasMore),
        messages,
        total: Number(live.total) || messages.length,
        unreadCount: messages.filter((message) => message.isUnread).length,
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Gmail unavailable';
      throw new BadGatewayException({
        success: false,
        code: 'GMAIL_UNAVAILABLE',
        message:
          'Gmail could not be loaded. Check the profile email, Google app password, and Notify/Unnecessary label.',
        error: detail,
      });
    }
  }

  async listBodies(applierName: string, idsRaw: string[], labelRaw?: string) {
    const ids = [
      ...new Set(
        idsRaw
          .map((value) => Number.parseInt(String(value).trim(), 10))
          .filter((uid) => Number.isSafeInteger(uid) && uid > 0),
      ),
    ].slice(0, MAX_BODY_BATCH_SIZE);
    if (!ids.length) {
      throw new BadRequestException({
        success: false,
        code: 'INVALID_MESSAGE_IDS',
        message: 'At least one valid Gmail message ID is required.',
      });
    }

    const creds = await this.requireCreds(applierName);
    const label = String(labelRaw || '').trim() || ATHENS_LENS_GMAIL_LABEL;

    try {
      const live = await this.imap.fetchTextBodiesByUid(
        creds.email,
        creds.password,
        label,
        ids,
      );
      const messages = live
        .map((row) =>
          mapLensGmailMessage({
            uid: row.uid,
            from: row.from,
            fromName: row.fromName,
            subject: row.subject,
            date: row.date,
            seen: row.seen,
            bodyText: row.bodyText,
          }),
        )
        .filter((message) => message.id);
      return { success: true as const, messages };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Gmail unavailable';
      throw new BadGatewayException({
        success: false,
        code: 'GMAIL_UNAVAILABLE',
        message: 'Gmail message content could not be loaded.',
        error: detail,
      });
    }
  }

  private async requireCreds(applierName: string) {
    const credentials = await this.credentials.resolve(applierName);
    if (!credentials.ok) {
      throw new ConflictException({
        success: false,
        code: 'GMAIL_NOT_CONFIGURED',
        message: credentials.error,
      });
    }
    return credentials;
  }
}
