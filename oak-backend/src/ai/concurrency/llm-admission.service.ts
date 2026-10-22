import { Injectable } from '@nestjs/common';
import {
  LLM_GLOBAL_CONCURRENCY,
  LLM_PER_USER_CONCURRENCY,
} from '../constants/ai-concurrency.constants';
import { createFairLimiter, type FairLimiter } from './create-limiter';

/**
 * Process-wide LLM admission: global + per-profile fairness.
 * Title review and AI analyze share this pool.
 */
@Injectable()
export class LlmAdmissionService {
  private readonly limiter: FairLimiter = createFairLimiter({
    globalConcurrency: LLM_GLOBAL_CONCURRENCY,
    perKeyConcurrency: LLM_PER_USER_CONCURRENCY,
  });

  run<T>(
    profileKey: string,
    fn: () => Promise<T>,
    opts?: { signal?: AbortSignal },
  ): Promise<T> {
    return this.limiter.run(profileKey || 'anonymous', fn, opts);
  }

  get globalActive() {
    return this.limiter.globalActive;
  }

  get pending() {
    return this.limiter.pending;
  }
}
