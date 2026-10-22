import { HttpException, Injectable } from '@nestjs/common';
import { ACORN_VERIFY_MAIL_PATH } from '../../acorn/acorn.constants';
import {
  AcornApiClient,
  acornErrorMessage,
  type AcornApiResult,
} from '../../acorn/acorn-api-client.service';

/**
 * The verification emails the Gmail watcher labelled for this account. The list and
 * each message are read from acorn-backend (which reads Gmail) as the signed-in person;
 * Oak keeps nothing and does not log what an email says.
 */
@Injectable()
export class OakEmailsService {
  constructor(private readonly acorn: AcornApiClient) {}

  async list(token: string) {
    return this.pass(
      await this.acorn.request('GET', ACORN_VERIFY_MAIL_PATH, { token }),
      'Could not load the emails',
    );
  }

  async get(token: string, mailboxId: string, messageId: string) {
    const path = `${ACORN_VERIFY_MAIL_PATH}/${encodeURIComponent(mailboxId)}/${encodeURIComponent(messageId)}`;
    return this.pass(
      await this.acorn.request('GET', path, { token }),
      'Could not load the email',
    );
  }

  private pass(res: AcornApiResult, fallback: string) {
    if (!res.ok) {
      throw new HttpException(
        {
          success: false,
          error: acornErrorMessage(res, fallback),
          code: res.body.code,
        },
        res.status,
      );
    }
    return res.body;
  }
}
