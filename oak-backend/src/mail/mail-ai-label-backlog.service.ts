import { Injectable, Logger } from '@nestjs/common';
import {
  MAIL_AI_LABEL_BACKLOG_MAX_MESSAGES,
  MAIL_AI_LABEL_MAX_MESSAGES,
  MAIL_AI_LABEL_MAX_RESULT_ROWS,
} from './constants/mail.constants';
import { MailAiLabelService } from './mail-ai-label.service';
import {
  formatMessageId,
  logMailAiLabel,
  mergeUsage,
  type MailAiLabelProgress,
  type MailAiLabelResult,
} from './mail-ai-label.parse';
import { MailCacheService } from './mail-cache.service';
import type { MailCredentialsOk } from './mail-credentials.service';
import { MailSyncService } from './mail-sync.service';

/** Bounds the forward scan when a whole page of unlabeled mail already failed. */
const MAX_SCAN_PAGES = 20;

type BacklogTotals = {
  completed: number;
  applied: number;
  failed: number;
  skipped: number;
};

/**
 * Works through the unlabeled inbox backlog in chunks, since one AI label run
 * handles at most MAIL_AI_LABEL_MAX_MESSAGES messages.
 */
@Injectable()
export class MailAiLabelBacklogService {
  private readonly logger = new Logger(MailAiLabelBacklogService.name);

  constructor(
    private readonly aiLabel: MailAiLabelService,
    private readonly cache: MailCacheService,
    private readonly sync: MailSyncService,
  ) {}

  async run(input: {
    creds: MailCredentialsOk;
    limit?: number;
    onProgress?: (progress: MailAiLabelProgress) => Promise<void> | void;
    signal?: AbortSignal;
  }) {
    const started = Date.now();
    const limit = Math.min(
      input.limit || MAIL_AI_LABEL_BACKLOG_MAX_MESSAGES,
      MAIL_AI_LABEL_BACKLOG_MAX_MESSAGES,
    );
    let backlog = 0;
    let unlabeledUids: number[] | null = null;
    try {
      unlabeledUids = await this.sync.getUnlabeledUids(input.creds, true);
      backlog = unlabeledUids.length;
    } catch {
      try {
        backlog = await this.cache.countUnlabeled(
          input.creds.applierName,
          'INBOX',
        );
      } catch {
        backlog = 0;
      }
    }
    const total = Math.min(backlog, limit);

    const attempted = new Set<string>();
    const totals: BacklogTotals = {
      completed: 0,
      applied: 0,
      failed: 0,
      skipped: 0,
    };
    const results: MailAiLabelResult[] = [];
    let usage: Record<string, unknown> | undefined;
    let aiRequests = 0;
    let gmailWriteBatches = 0;
    let chunks = 0;
    let model: { provider: string; model: string } | undefined;

    logMailAiLabel(this.logger, 'backlog_start', { backlog, total, limit });

    while (!input.signal?.aborted && attempted.size < total) {
      const want = Math.min(MAIL_AI_LABEL_MAX_MESSAGES, total - attempted.size);
      const messageIds = await this.nextChunk(
        input.creds,
        attempted,
        want,
        unlabeledUids,
      );
      // Empty means the backlog is done, or every remaining row was already
      // tried this run. Without this the same failing rows would loop forever.
      if (!messageIds.length) break;
      for (const id of messageIds) attempted.add(id);
      chunks += 1;

      let batch: Awaited<ReturnType<MailAiLabelService['runBatch']>>;
      try {
        batch = await this.aiLabel.runBatch({
          creds: input.creds,
          messageIds,
          signal: input.signal,
          onProgress: (chunk) =>
            input.onProgress?.({
              total,
              completed: totals.completed + chunk.completed,
              applied: totals.applied + chunk.applied,
              failed: totals.failed + chunk.failed,
              skipped: totals.skipped + chunk.skipped,
              phase: chunk.phase,
              // Only this chunk's items, so the task document and SSE payload
              // stay bounded no matter how large the backlog is.
              items: chunk.items,
            }),
        });
      } catch (err) {
        // Stop mid-chunk aborts the run; return what earlier chunks finished
        // instead of throwing all of it away.
        if (input.signal?.aborted) break;
        throw err;
      }

      for (const result of batch.results) {
        totals.completed += 1;
        if (result.applied) totals.applied += 1;
        else if (result.reason === 'no_match') totals.skipped += 1;
        else totals.failed += 1;
      }
      results.push(...batch.results);
      if (results.length > MAIL_AI_LABEL_MAX_RESULT_ROWS) {
        results.splice(0, results.length - MAIL_AI_LABEL_MAX_RESULT_ROWS);
      }
      usage = mergeUsage(usage, batch.usage);
      aiRequests += batch.processing.aiRequests;
      gmailWriteBatches += batch.processing.gmailWriteBatches;
      model = batch.model;
    }

    let remaining = 0;
    try {
      remaining = await this.sync.countUnlabeledInbox(input.creds, true);
    } catch {
      remaining = await this.cache.countUnlabeled(
        input.creds.applierName,
        'INBOX',
      );
    }
    await input.onProgress?.({ total, ...totals, phase: 'done', items: {} });
    logMailAiLabel(this.logger, 'backlog_done', {
      chunks,
      attempted: attempted.size,
      applied: totals.applied,
      failed: totals.failed,
      skipped: totals.skipped,
      remaining,
      ms: Date.now() - started,
    });

    return {
      results,
      usage,
      model,
      backlog: {
        scanned: attempted.size,
        remaining,
        chunks,
        truncated: results.length < totals.completed,
      },
      processing: {
        durationMs: Date.now() - started,
        messages: totals.completed,
        applied: totals.applied,
        failed: totals.failed,
        skipped: totals.skipped,
        aiRequests,
        gmailWriteBatches,
      },
    };
  }

  /**
   * Next unlabeled ids not yet tried in this run. Uses the Gmail labels scan,
   * not Mongo, so unlabeled mail that was never envelope-cached still runs.
   */
  private async nextChunk(
    creds: MailCredentialsOk,
    attempted: Set<string>,
    want: number,
    unlabeledUids: number[] | null,
  ): Promise<string[]> {
    const ids: string[] = [];
    if (unlabeledUids) {
      for (const uid of unlabeledUids) {
        const id = formatMessageId('INBOX', uid);
        if (attempted.has(id)) continue;
        ids.push(id);
        if (ids.length >= want) break;
      }
      return ids;
    }
    for (let page = 1; page <= MAX_SCAN_PAGES && ids.length < want; page++) {
      const listed = await this.cache.listMessages(creds.applierName, {
        unlabeled: true,
        mailbox: 'INBOX',
        page,
        pageSize: MAIL_AI_LABEL_MAX_MESSAGES,
      });
      if (!listed.rows.length) break;
      for (const row of listed.rows) {
        const id = formatMessageId(row.mailbox, row.uid);
        if (attempted.has(id)) continue;
        ids.push(id);
        if (ids.length >= want) break;
      }
      if (!listed.hasMore) break;
    }
    return ids;
  }
}
