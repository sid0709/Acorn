import { createHash } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  ACORN_RUNS_PATH,
  ACORN_RUN_SCREENSHOT_MAX_BYTES,
  ACORN_RUN_SCREENSHOT_SUFFIX,
  ACORN_UPLOAD_TIMEOUT_MS,
} from '../../acorn/acorn.constants';
import {
  AcornApiClient,
  acornErrorMessage,
} from '../../acorn/acorn-api-client.service';
import { AcornUsageService } from '../../acorn/acorn-usage.service';
import { currentAcornContext } from '../../acorn/request-context';
import type { OakPublicSession } from '../auth/oak-session.service';
import type { OakSentDto } from './dto/sent.dto';

const JPEG_MIME = 'image/jpeg';
/** First bytes of every JPEG file. */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_RECORD_ID = 64;

/**
 * Sent: counts the page as an application Acorn sent for the person — a Run on
 * their dashboard — with the page's model cost and a full-page screenshot.
 */
@Injectable()
export class OakSentService {
  constructor(
    private readonly acorn: AcornApiClient,
    private readonly usage: AcornUsageService,
  ) {}

  async record(token: string, session: OakPublicSession, dto: OakSentDto) {
    const { tabKey } = currentAcornContext();
    if (!tabKey) {
      throw new BadRequestException({
        success: false,
        error: 'Missing X-Acorn-Tab header',
      });
    }
    const image = Buffer.from(dto.screenshot, 'base64');
    if (!image.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
      throw new BadRequestException({
        success: false,
        error: 'The screenshot must be a JPEG',
      });
    }
    if (image.length > ACORN_RUN_SCREENSHOT_MAX_BYTES) {
      throw new PayloadTooLargeException({
        success: false,
        error: 'The screenshot is too large',
      });
    }

    const cost = await this.usage.tabCost(session.accountId, tabKey);
    // The same page sent again is one application, so a retry after a lost answer counts once.
    const recordId = createHash('sha256')
      .update(`${session.accountId}\n${tabKey}\n${dto.url}`)
      .digest('hex')
      .slice(0, MAX_RECORD_ID);

    const run = await this.acorn.request('POST', ACORN_RUNS_PATH, {
      token,
      json: {
        recordId,
        runId: tabKey,
        url: dto.url,
        title: dto.title,
        endedAt: dto.endedAt ?? Date.now(),
        utcOffsetMinutes: dto.utcOffsetMinutes,
        durationMs: dto.durationMs,
        costNanos: cost.costNanos,
        steps: dto.steps,
        modelCalls: cost.calls,
        screenChecks: 0,
      },
    });
    const id = typeof run.body.id === 'string' ? run.body.id : '';
    if (!run.ok || !id) {
      throw new BadGatewayException({
        success: false,
        error: acornErrorMessage(run, 'Acorn could not record the application'),
      });
    }

    const shot = await this.acorn.request(
      'PUT',
      `${ACORN_RUNS_PATH}/${encodeURIComponent(id)}/${ACORN_RUN_SCREENSHOT_SUFFIX}`,
      {
        token,
        bytes: image,
        contentType: JPEG_MIME,
        timeoutMs: ACORN_UPLOAD_TIMEOUT_MS,
      },
    );
    if (!shot.ok) {
      throw new BadGatewayException({
        success: false,
        error: acornErrorMessage(shot, 'Acorn could not store the screenshot'),
      });
    }
    return {
      success: true as const,
      recorded: run.body.recorded === true,
      runId: id,
      costNanos: cost.costNanos,
    };
  }
}
