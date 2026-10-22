import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildAccountPurgeSteps } from './account-data-purge-steps';
import type { AccountDeleteProgressFn } from './lib/account-delete-progress';
import { accountDeletePercent } from './lib/account-delete-progress';

/** Deletes applier-owned Mongo rows. Does not delete AccountInfo or Storage. */
@Injectable()
export class AccountDataPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async countOwnedRows(
    profileId: string,
    applierName: string,
  ): Promise<number> {
    const steps = await buildAccountPurgeSteps(
      this.prisma,
      profileId,
      applierName,
    );
    let total = 0;
    for (const step of steps) {
      total += await step.count();
    }
    return total;
  }

  async purgeOwnedRows(
    profileId: string,
    applierName: string,
    ctx?: {
      removed: number;
      total: number;
      onProgress?: AccountDeleteProgressFn;
    },
  ): Promise<number> {
    const steps = await buildAccountPurgeSteps(
      this.prisma,
      profileId,
      applierName,
    );
    let removedHere = 0;
    let removed = ctx?.removed ?? 0;
    const total = ctx?.total ?? 0;

    for (const step of steps) {
      const count = await step.remove();
      removedHere += count;
      removed += count;
      await ctx?.onProgress?.({
        phase: 'database',
        message:
          count > 0
            ? `${step.label}… ${count} removed`
            : `${step.label}… none found`,
        removed,
        total,
        percent: accountDeletePercent(removed, total),
      });
    }

    return removedHere;
  }
}
