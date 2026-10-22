import { Injectable } from '@nestjs/common';
import { chunkArray, mapPool } from '../concurrency/create-limiter';
import { LlmAdmissionService } from '../concurrency/llm-admission.service';

export type WaveBatchOptions<TItem, TBatchResult> = {
  /** Items already claimed for this wave. */
  items: TItem[];
  batchSize: number;
  batchConcurrency: number;
  profileKey: string;
  signal?: AbortSignal;
  processBatch: (batch: TItem[]) => Promise<TBatchResult>;
};

/**
 * Generic wave runner: chunk claimed items → parallel batches through LLM admission.
 */
@Injectable()
export class WaveBatchRunner {
  constructor(private readonly admission: LlmAdmissionService) {}

  async runBatches<TItem, TBatchResult>(
    opts: WaveBatchOptions<TItem, TBatchResult>,
  ): Promise<TBatchResult[]> {
    const batches = chunkArray(opts.items, opts.batchSize);
    if (!batches.length) return [];

    return mapPool(batches, opts.batchConcurrency, async (batch) => {
      if (opts.signal?.aborted) {
        throw opts.signal.reason instanceof Error
          ? opts.signal.reason
          : Object.assign(new Error('Wave aborted'), { name: 'AbortError' });
      }
      return this.admission.run(
        opts.profileKey,
        () => opts.processBatch(batch),
        { signal: opts.signal },
      );
    });
  }
}
