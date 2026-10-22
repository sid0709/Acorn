import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProfileLlmAuthService,
  type ProfileLlmAuth,
} from '../../ai/auth/profile-llm-auth.service';
import { WaveBatchRunner } from '../../ai/batch/wave-batch.runner';
import {
  TITLE_REVIEW_BATCH_CONCURRENCY,
  TITLE_REVIEW_BATCH_SIZE,
} from '../../ai/constants/ai-concurrency.constants';
import { TitleReviewClaimService } from '../claim/title-review-claim.service';
import { TempJobQueueService } from '../temp-job-queue.service';
import { TitleReviewProcessService } from './title-review-process.service';

type SessionState = {
  sessionId: string;
  status: 'running' | 'stopping' | 'idle';
  auth: ProfileLlmAuth;
  controller: AbortController;
  startedAt: string;
  processed: number;
  approved: number;
  reviewRequired: number;
  failed: number;
  loop: Promise<void> | null;
};

@Injectable()
export class TitleReviewSessionService {
  private readonly logger = new Logger(TitleReviewSessionService.name);
  private session: SessionState | null = null;

  constructor(
    private readonly authService: ProfileLlmAuthService,
    private readonly claims: TitleReviewClaimService,
    private readonly process: TitleReviewProcessService,
    private readonly waves: WaveBatchRunner,
    private readonly queues: TempJobQueueService,
  ) {}

  async start(input: { applierName?: string; profileId?: string }) {
    if (this.session?.status === 'running') {
      throw new BadRequestException({
        success: false,
        message: 'Title review is already running.',
        error: 'Title review is already running.',
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
      approved: 0,
      reviewRequired: 0,
      failed: 0,
      loop: null,
    };
    this.session = state;
    state.loop = this.runLoop(state).finally(() => {
      if (this.session?.sessionId === sessionId) {
        this.session = {
          ...state,
          status: 'idle',
          loop: null,
        };
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
    const counts = await this.queues.titleReviewCounts();
    const s = this.session;
    const running = s?.status === 'running' || s?.status === 'stopping';
    return {
      success: true as const,
      running,
      status: s?.status ?? 'idle',
      sessionId: s?.sessionId ?? null,
      startedAt: s?.startedAt ?? null,
      processed: s?.processed ?? 0,
      approved: s?.approved ?? 0,
      reviewRequired: s?.reviewRequired ?? 0,
      failed: s?.failed ?? 0,
      ...counts,
    };
  }

  private async runLoop(state: SessionState) {
    const waveSize = TITLE_REVIEW_BATCH_SIZE * TITLE_REVIEW_BATCH_CONCURRENCY;
    const attemptedIds = new Set<string>();
    try {
      while (state.status === 'running' && !state.controller.signal.aborted) {
        const claimed = await this.claims.claimWave(state.sessionId, waveSize, [
          ...attemptedIds,
        ]);
        if (!claimed.length) break;
        for (const job of claimed) attemptedIds.add(job.id);

        const results = await this.waves.runBatches({
          items: claimed,
          batchSize: TITLE_REVIEW_BATCH_SIZE,
          batchConcurrency: TITLE_REVIEW_BATCH_CONCURRENCY,
          profileKey: state.auth.profileId,
          signal: state.controller.signal,
          processBatch: (batch) =>
            this.process.classifyAndPersistBatch({
              jobs: batch,
              auth: state.auth,
              sessionId: state.sessionId,
              signal: state.controller.signal,
            }),
        });

        for (const stats of results) {
          state.processed += stats.processed;
          state.approved += stats.approved;
          state.reviewRequired += stats.reviewRequired;
          state.failed += stats.failed;
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      this.logger.error(
        `Title review session failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.claims.releaseSession(state.sessionId);
      state.status = 'idle';
    }
  }
}
