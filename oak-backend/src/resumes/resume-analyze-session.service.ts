import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Resume } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  ProfileLlmAuthService,
  type ProfileLlmAuth,
} from '../ai/auth/profile-llm-auth.service';
import { WaveBatchRunner } from '../ai/batch/wave-batch.runner';
import {
  RESUME_ANALYZE_BATCH_CONCURRENCY,
  RESUME_ANALYZE_BATCH_SIZE,
} from '../ai/constants/ai-concurrency.constants';
import { asText } from '../personal/mappers/as-text';
import { OBJECT_ID_PATTERN } from '../personal/constants/profile-field.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  ResumeAnalyzeProcessService,
  type ResumeAnalyzeItemResult,
} from './resume-analyze-process.service';

type ItemProgress = {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
  skillCount?: number;
  alreadyAnalyzed?: boolean;
};

type SessionState = {
  sessionId: string;
  status:
    'running' | 'stopping' | 'completed' | 'cancelled' | 'failed' | 'idle';
  auth: ProfileLlmAuth;
  controller: AbortController;
  startedAt: string;
  finishedAt: string | null;
  force: boolean;
  resumeIds: string[];
  items: Record<string, ItemProgress>;
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  error: string | null;
  loop: Promise<void> | null;
};

@Injectable()
export class ResumeAnalyzeSessionService {
  private readonly logger = new Logger(ResumeAnalyzeSessionService.name);
  private session: SessionState | null = null;

  constructor(
    private readonly authService: ProfileLlmAuthService,
    private readonly process: ResumeAnalyzeProcessService,
    private readonly waves: WaveBatchRunner,
    private readonly prisma: PrismaService,
  ) {}

  async start(input: {
    applierName?: string;
    ownerName?: string;
    profileId?: string;
    resumeIds: string[];
    force?: boolean;
  }) {
    if (
      this.session?.status === 'running' ||
      this.session?.status === 'stopping'
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Resume analysis is already running.',
        error: 'Resume analysis is already running.',
      });
    }

    const applierName =
      asText(input.applierName).trim() || asText(input.ownerName).trim();
    const resumeIds = [
      ...new Set(
        (input.resumeIds || [])
          .map((id) => asText(id).trim())
          .filter((id) => OBJECT_ID_PATTERN.test(id)),
      ),
    ];
    if (!resumeIds.length) {
      throw new BadRequestException({
        success: false,
        message: 'resumeIds is required',
        error: 'resumeIds is required',
      });
    }

    const auth = await this.authService.resolve({
      applierName,
      profileId: input.profileId,
    });

    const owned = await this.prisma.resume.findMany({
      where: { id: { in: resumeIds }, profileId: auth.profileId },
    });
    if (!owned.length) {
      throw new BadRequestException({
        success: false,
        message: 'No matching resumes found for this profile.',
        error: 'No matching resumes found for this profile.',
      });
    }

    const items: Record<string, ItemProgress> = {};
    for (const r of owned) {
      items[r.id] = { status: 'queued' };
    }

    const sessionId = randomUUID();
    const controller = new AbortController();
    const state: SessionState = {
      sessionId,
      status: 'running',
      auth,
      controller,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      force: Boolean(input.force),
      resumeIds: owned.map((r) => r.id),
      items,
      processed: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      error: null,
      loop: null,
    };
    this.session = state;
    state.loop = this.runLoop(state, owned).finally(() => {
      if (this.session?.sessionId === sessionId) {
        this.session = {
          ...state,
          status:
            state.status === 'stopping'
              ? 'cancelled'
              : state.status === 'failed'
                ? 'failed'
                : 'completed',
          finishedAt: new Date().toISOString(),
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

  private statusPayload() {
    const s = this.session;
    const running = s?.status === 'running' || s?.status === 'stopping';
    return {
      success: true as const,
      running,
      status: s?.status ?? 'idle',
      sessionId: s?.sessionId ?? null,
      startedAt: s?.startedAt ?? null,
      finishedAt: s?.finishedAt ?? null,
      total: s?.resumeIds.length ?? 0,
      processed: s?.processed ?? 0,
      completed: s?.completed ?? 0,
      failed: s?.failed ?? 0,
      skipped: s?.skipped ?? 0,
      error: s?.error ?? null,
      concurrency: RESUME_ANALYZE_BATCH_CONCURRENCY,
      batchSize: RESUME_ANALYZE_BATCH_SIZE,
      items: s?.items ?? {},
      progress: {
        total: s?.resumeIds.length ?? 0,
        completed: s?.completed ?? 0,
        failed: s?.failed ?? 0,
        skipped: s?.skipped ?? 0,
        items: s?.items ?? {},
      },
    };
  }

  private async runLoop(state: SessionState, resumes: Resume[]) {
    try {
      const results = await this.waves.runBatches({
        items: resumes,
        batchSize: RESUME_ANALYZE_BATCH_SIZE,
        batchConcurrency: RESUME_ANALYZE_BATCH_CONCURRENCY,
        profileKey: state.auth.profileId,
        signal: state.controller.signal,
        processBatch: async (batch) => {
          const resume = batch[0];
          if (!resume) return null;
          state.items[resume.id] = { status: 'running' };
          const result = await this.process.analyzeOne({
            resume,
            auth: state.auth,
            force: state.force,
            signal: state.controller.signal,
          });
          this.applyResult(state, result);
          return result;
        },
      });
      void results;
      if (state.status === 'running') state.status = 'completed';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        state.status = 'cancelled';
        return;
      }
      state.error = err instanceof Error ? err.message : String(err);
      state.status = 'failed';
      this.logger.error(`Resume analyze session failed: ${state.error}`);
    } finally {
      state.finishedAt = new Date().toISOString();
      if (state.status === 'running') state.status = 'completed';
      if (state.status === 'stopping') state.status = 'cancelled';
    }
  }

  private applyResult(state: SessionState, result: ResumeAnalyzeItemResult) {
    state.processed += 1;
    if (result.status === 'completed') {
      state.completed += 1;
      state.items[result.resumeId] = {
        status: 'completed',
        skillCount: result.skillCount,
      };
    } else if (result.status === 'skipped') {
      state.skipped += 1;
      state.items[result.resumeId] = {
        status: 'skipped',
        alreadyAnalyzed: true,
        skillCount: result.skillCount,
      };
    } else {
      state.failed += 1;
      state.items[result.resumeId] = {
        status: 'failed',
        error: result.error || 'Analysis failed',
      };
    }
  }
}
