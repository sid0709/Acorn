import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccountInfoService } from '../auth/account-info.service';
import { ProfileSecretsService } from '../personal/secrets/profile-secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_USAGE_TOTALS_GROUP,
  EMPTY_AI_USAGE_TOTALS,
} from './constants/ai-usage.constants';
import {
  buildAiUsageRawMatch,
  type AiUsageFilterInput,
} from './lib/ai-usage-match';
import { roundCostUsd } from './lib/mask-api-key';
import { buildUsageByName } from './mappers/ai-usage-monitor.mapper';
import {
  buildMonitorUsers,
  buildUnassigned,
} from './mappers/ai-usage-monitor-users.mapper';

@Injectable()
export class AiUsageMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly secrets: ProfileSecretsService,
  ) {}

  async monitor(query: AiUsageFilterInput) {
    const match = buildAiUsageRawMatch(query);
    const [accounts, byApplier, byApplierProvider, byApplierFeature, overall] =
      await Promise.all([
        this.accounts.list(),
        this.agg([
          { $match: match },
          {
            $group: {
              _id: { $ifNull: ['$applierName', ''] },
              calls: { $sum: 1 },
              inputTokens: { $sum: '$inputTokens' },
              cachedInputTokens: { $sum: '$cachedInputTokens' },
              outputTokens: { $sum: '$outputTokens' },
              totalTokens: { $sum: '$totalTokens' },
              costUsd: { $sum: '$costUsd' },
              lastCallAt: { $max: '$createdAt' },
            },
          },
        ]),
        this.agg([
          { $match: match },
          {
            $group: {
              _id: {
                applierName: { $ifNull: ['$applierName', ''] },
                provider: { $ifNull: ['$provider', 'unknown'] },
                billedModel: { $ifNull: ['$billedModel', 'unknown'] },
              },
              calls: { $sum: 1 },
              inputTokens: { $sum: '$inputTokens' },
              cachedInputTokens: { $sum: '$cachedInputTokens' },
              outputTokens: { $sum: '$outputTokens' },
              totalTokens: { $sum: '$totalTokens' },
              costUsd: { $sum: '$costUsd' },
            },
          },
          { $sort: { costUsd: -1 } },
        ]),
        this.agg([
          { $match: match },
          {
            $group: {
              _id: {
                applierName: { $ifNull: ['$applierName', ''] },
                feature: { $ifNull: ['$feature', 'unknown'] },
              },
              calls: { $sum: 1 },
              costUsd: { $sum: '$costUsd' },
              totalTokens: { $sum: '$totalTokens' },
            },
          },
          { $sort: { costUsd: -1 } },
        ]),
        this.agg([{ $match: match }, { $group: AI_USAGE_TOTALS_GROUP }]),
      ]);

    const usageByName = buildUsageByName({
      byApplier,
      byApplierProvider,
      byApplierFeature,
    });
    const { users, keyIndex } = buildMonitorUsers({
      accounts,
      usageByName,
      decryptProfile: (profile) =>
        this.secrets.decryptForClient(profile).profile,
    });
    const knownNames = new Set(users.map((u) => u.name));
    const unassigned = buildUnassigned(usageByName, knownNames);
    const apiKeys = [...keyIndex.values()].sort(
      (a, b) =>
        (b.costUsd || 0) - (a.costUsd || 0) ||
        a.provider.localeCompare(b.provider),
    );
    const totals = {
      ...EMPTY_AI_USAGE_TOTALS,
      ...(overall[0] as Record<string, unknown> | undefined),
    };
    totals.costUsd = roundCostUsd(totals.costUsd);

    return {
      totals: {
        ...totals,
        registeredUsers: users.length,
        usersWithKeys: users.filter((u) => u.keys.some((k) => k.configured))
          .length,
        usersWithUsage: users.filter((u) => (u.usage.calls || 0) > 0).length,
        configuredKeys: apiKeys.length,
      },
      users,
      apiKeys,
      unassigned,
    };
  }

  private async agg(
    pipeline: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const raw = await this.prisma.aiApiUsage.aggregateRaw({
      pipeline: pipeline as Prisma.InputJsonValue[],
    });
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }
}
