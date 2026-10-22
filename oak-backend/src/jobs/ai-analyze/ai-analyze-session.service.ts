import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProfileLlmAuthService,
  type ProfileLlmAuth,
} from '../../ai/auth/profile-llm-auth.service';
import { WaveBatchRunner } from '../../ai/batch/wave-batch.runner';
import {
  AI_ANALYZE_BATCH_CONCURRENCY,
  AI_ANALYZE_BATCH_SIZE,
} from '../../ai/constants/ai-concurrency.constants';
import { AiAnalyzeClaimService } from '../claim/ai-analyze-claim.service';
import { TempJobPromotionService } from '../temp-job-promotion.service';
import { TempJobQueueService } from '../temp-job-queue.service';
import { AiAnalyzeProcessService } from './ai-analyze-process.service';

type SessionState = {
  sessionId: string;
  status: 'running' | 'stopping' | 'idle';
  auth: ProfileLlmAuth;
  controller: AbortController;
  startedAt: string;
  processed: number;
  extracted: number;
  failed: number;
  promoted: number;
  remoteReviewQueued: number;
  loop: Promise<void> | null;
};

@Injectable()
export class AiAnalyzeSessionService {
  private readonly logger = new Logger(AiAnalyzeSessionService.name);
  private session: SessionState | null = null;

  constructor(
    private readonly authService: ProfileLlmAuthService,
    private readonly claims: AiAnalyzeClaimService,
    private readonly process: AiAnalyzeProcessService,
    private readonly waves: WaveBatchRunner,
    private readonly queues: TempJobQueueService,
    private readonly promotion: TempJobPromotionService,
  ) {}

  async start(input: { applierName?: string; profileId?: string }) {
    if (this.session?.status === 'running') {
      throw new BadRequestException({
        success: false,
        message: 'AI analyze is already running.',
        error: 'AI analyze is already running.',
      });
    }

    const auth = await this.authService.resolve(input);
    const sessionId = randomUUID();
    const controller = new AbortController();
    const state: SessionState = {
      sessionId,
      status: 'running',
      auth,
      controller,
      startedAt: new Date().toISOString(),
      processed: 0,
      extracted: 0,
      failed: 0,
      promoted: 0,
      remoteReviewQueued: 0,
      loop: null,
    };
    this.session = state;
    state.loop = this.runLoop(state).finally(() => {
      if (this.session?.sessionId === sessionId) {
        this.session = { ...state, status: 'idle', loop: null };
      }
    });

    return this.statusPayload();
  }

  async stop() {
    const current = this.session;
    if (!current || current.status !== 'running') {
      return this.statusPayload();
    }
    current.status = 'stopping';
    current.controller.abort();
    await this.claims.releaseSession(current.sessionId);
    if (current.loop) {
      try {
        await current.loop;
      } catch {
        /* drained */
      }
    }
    return this.statusPayload();
  }

  async status() {
    return this.statusPayload();
  }

  private async statusPayload() {
    const pending = await this.queues.skillExtractPendingCount();
    const s = this.session;
    const running = s?.status === 'running' || s?.status === 'stopping';
    return {
      success: true as const,
      running,
      status: s?.status ?? 'idle',
      sessionId: s?.sessionId ?? null,
      startedAt: s?.startedAt ?? null,
      pending,
      pendingKnown: true,
      total: pending + (s?.processed ?? 0),
      processed: s?.processed ?? 0,
      extracted: s?.extracted ?? 0,
      failed: s?.failed ?? 0,
      promoted: s?.promoted ?? 0,
      remoteReviewQueued: s?.remoteReviewQueued ?? 0,
      remaining: pending,
    };
  }

  private async runLoop(state: SessionState) {
    const waveSize = AI_ANALYZE_BATCH_SIZE * AI_ANALYZE_BATCH_CONCURRENCY;
    const attemptedIds = new Set<string>();
    try {
      while (state.status === 'running' && !state.controller.signal.aborted) {
        // Promote-ready stuck rows (extracted / skipped_duplicate) — no LLM.
        const promoteWave = await this.promotion.promoteReadyBatch(waveSize);
        state.promoted += promoteWave.promoted;
        state.processed += promoteWave.promoted;

        const claimed = await this.claims.claimWave(state.sessionId, waveSize, [
          ...attemptedIds,
        ]);
        if (!claimed.length) {
          if (promoteWave.attempted === 0) break;
          continue;
        }
        for (const job of claimed) attemptedIds.add(job.id);

        const results = await this.waves.runBatches({
          items: claimed,
          batchSize: AI_ANALYZE_BATCH_SIZE,
          batchConcurrency: AI_ANALYZE_BATCH_CONCURRENCY,
          profileKey: state.auth.profileId,
          signal: state.controller.signal,
          processBatch: (batch) =>
            this.process.analyzeAndPersistBatch({
              jobs: batch,
              auth: state.auth,
              sessionId: state.sessionId,
              signal: state.controller.signal,
            }),
        });

        for (const stats of results) {
          state.processed += stats.processed;
          state.extracted += stats.extracted;
          state.failed += stats.failed;
          state.promoted += stats.promoted;
          state.remoteReviewQueued += stats.remoteReviewQueued;
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      this.logger.error(
        `AI analyze session failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.claims.releaseSession(state.sessionId);
      state.status = 'idle';
    }
  }
}
