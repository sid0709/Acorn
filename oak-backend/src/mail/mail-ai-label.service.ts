import { Injectable, Logger } from '@nestjs/common';
import { ProfileLlmAuthService } from '../ai/auth/profile-llm-auth.service';
import { WaveBatchRunner } from '../ai/batch/wave-batch.runner';
import {
  MAIL_AI_LABEL_BATCH_CONCURRENCY,
  MAIL_AI_LABEL_BATCH_SIZE,
  MAIL_AI_LABEL_BODY_MAX_CHARS,
} from '../ai/constants/ai-concurrency.constants';
import { MailAiLabelApplyService } from './mail-ai-label-apply.service';
import type { MailAiLabelClassifyBatch } from './mail-ai-label-classify.service';
import { MailAiLabelClassifyService } from './mail-ai-label-classify.service';
import { MailAiLabelLoadService } from './mail-ai-label-load.service';
import {
  formatEmailText,
  isAbortError,
  logMailAiLabel,
  mailAiLabelFailureClass,
  mergeUsage,
  type MailAiLabelProgress,
  type MailAiLabelResult,
} from './mail-ai-label.parse';
import { classifyThenApplyBatch } from './mail-ai-label-wave';
import type { MailCredentialsOk } from './mail-credentials.service';
import { MailLabelDefinitionsService } from './mail-label-definitions.service';
import { MailSyncService } from './mail-sync.service';

export type { MailAiLabelProgress, MailAiLabelResult };

@Injectable()
export class MailAiLabelService {
  private readonly logger = new Logger(MailAiLabelService.name);

  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly waves: WaveBatchRunner,
    private readonly classify: MailAiLabelClassifyService,
    private readonly loader: MailAiLabelLoadService,
    private readonly apply: MailAiLabelApplyService,
    private readonly sync: MailSyncService,
    private readonly definitions: MailLabelDefinitionsService,
  ) {}

  async prepare(creds: MailCredentialsOk, messageIds: string[]) {
    const auth = await this.llmAuth.resolve({
      applierName: creds.applierName,
    });
    const allowedLabels = await this.sync.allowedCustomLabelNames(creds);
    if (!allowedLabels.length) {
      throw new Error(
        'Create at least one custom Gmail label before AI labeling.',
      );
    }
    const labelDefinitions = await this.definitions.get(creds.applierName);
    return { auth, allowedLabels, labelDefinitions, messageIds };
  }

  async runBatch(input: {
    creds: MailCredentialsOk;
    messageIds: string[];
    onProgress?: (progress: MailAiLabelProgress) => Promise<void> | void;
    signal?: AbortSignal;
  }) {
    const started = Date.now();
    const prepared = await this.prepare(input.creds, input.messageIds);
    logMailAiLabel(this.logger, 'prepare', {
      ids: prepared.messageIds.length,
      gmailLabels: prepared.allowedLabels.length,
      provider: prepared.auth.provider,
      model: prepared.auth.model,
      prepMs: Date.now() - started,
    });
    const resultsById = new Map<string, MailAiLabelResult>();
    const items: Record<string, { result?: MailAiLabelResult }> = {};
    const stats = { completed: 0, applied: 0, failed: 0, skipped: 0 };
    let usage: Record<string, unknown> | undefined;
    let aiRequests = 0;
    let firstResultMs: number | null = null;

    const record = (id: string, result: MailAiLabelResult) => {
      if (resultsById.has(id)) return;
      resultsById.set(id, result);
      items[id] = { result };
      stats.completed += 1;
      if (result.applied) stats.applied += 1;
      else if (result.reason === 'no_match') stats.skipped += 1;
      else stats.failed += 1;
      if (firstResultMs == null) firstResultMs = Date.now() - started;
    };

    const report = async (
      phase: MailAiLabelProgress['phase'],
      extra?: Partial<MailAiLabelProgress>,
    ) => {
      await input.onProgress?.({
        total: prepared.messageIds.length,
        ...stats,
        phase,
        items,
        ...extra,
      });
    };

    await report('loading_snippets');
    const tLoad = Date.now();
    const { emails, loadFailed } = await this.loader.loadEmails(
      input.creds,
      prepared.messageIds,
    );
    for (const row of loadFailed) record(row.id, row.result);
    const snippetFetchMs = Date.now() - tLoad;
    const snippetCacheHits = emails.filter((email) => email.bodyText).length;

    await report('loading_body');
    const tBody = Date.now();
    const fullBodyFallbacks = await this.loader.fillBodies(input.creds, emails);
    const bodyFetchMs = Date.now() - tBody;
    logMailAiLabel(this.logger, 'gmail_ready', {
      emails: emails.length,
      cacheHits: snippetCacheHits,
      bodyFetches: fullBodyFallbacks,
      snippetMs: snippetFetchMs,
      bodyMs: bodyFetchMs,
    });

    const catalog = prepared.allowedLabels.map((name) => ({
      name,
      description: String(prepared.labelDefinitions[name] || '').trim(),
    }));
    let batches: MailAiLabelClassifyBatch[] = [];
    let gmailWriteBatches = 0;
    let aiRequestMs = 0;
    let gmailWriteMs = 0;

    await report('classifying_body');
    try {
      batches = await this.waves.runBatches({
        items: emails.map((email) => ({
          id: email.id,
          text: formatEmailText(email, MAIL_AI_LABEL_BODY_MAX_CHARS),
        })),
        batchSize: MAIL_AI_LABEL_BATCH_SIZE,
        batchConcurrency: MAIL_AI_LABEL_BATCH_CONCURRENCY,
        profileKey: prepared.auth.applierName,
        signal: input.signal,
        processBatch: async (batch) => {
          const step = await classifyThenApplyBatch({
            classify: this.classify,
            apply: this.apply,
            auth: prepared.auth,
            catalog,
            emails,
            batch,
            allowedLabels: prepared.allowedLabels,
            creds: input.creds,
            record,
            signal: input.signal,
          });
          aiRequestMs += step.classifyMs;
          gmailWriteMs += step.writeMs;
          gmailWriteBatches += step.writes;
          await report('classifying_body');
          return step.result;
        },
      });
    } catch (err) {
      if (!isAbortError(err) && !input.signal?.aborted) throw err;
    }
    for (const batch of batches) {
      usage = mergeUsage(usage, batch.usage);
      aiRequests += batch.requests;
    }
    for (const email of emails) {
      if (resultsById.has(email.id)) continue;
      record(email.id, {
        id: email.id,
        uid: email.uid,
        label: null,
        applied: false,
        reason: input.signal?.aborted ? 'classification_error' : 'no_match',
        error: input.signal?.aborted ? 'AI labeling was stopped.' : undefined,
      });
    }

    await report('done');
    this.sync.invalidateUnlabeledScan(input.creds.applierName);
    const results = prepared.messageIds
      .map((id) => resultsById.get(id))
      .filter((row): row is MailAiLabelResult => Boolean(row));
    logMailAiLabel(this.logger, 'done', {
      class: mailAiLabelFailureClass(results),
      applied: results.filter((row) => row.applied).length,
      failed: results.filter((row) => row.error).length,
      skipped: results.filter((row) => row.reason === 'no_match').length,
      aiRequests,
      gmailWrites: gmailWriteBatches,
      ms: Date.now() - started,
      firstError: results.find((row) => row.error)?.error || 'none',
    });
    return {
      results,
      usage,
      model: {
        provider: prepared.auth.provider,
        model: prepared.auth.model,
      },
      processing: {
        durationMs: Date.now() - started,
        messages: prepared.messageIds.length,
        aiRequests,
        gmailWriteBatches,
        snippetFetchMs,
        bodyFetchMs,
        aiRequestMs,
        gmailWriteMs,
        snippetCacheHits,
        fullBodyFallbacks,
        firstResultMs,
      },
    };
  }
}
