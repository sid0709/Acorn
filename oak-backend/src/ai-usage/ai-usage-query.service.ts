import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_USAGE_BY_DAY_PIPELINE,
  AI_USAGE_TOTALS_GROUP,
  EMPTY_AI_USAGE_TOTALS,
} from './constants/ai-usage.constants';
import {
  buildAiUsagePrismaWhere,
  buildAiUsageRawMatch,
  type AiUsageFilterInput,
} from './lib/ai-usage-match';
import { serializeAiUsageRow } from './mappers/ai-usage-row.mapper';

@Injectable()
export class AiUsageQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listRows(query: AiUsageFilterInput & { limit?: number }) {
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
    const where = buildAiUsagePrismaWhere(query);
    const rows = await this.prisma.aiApiUsage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      rows: rows
        .map((row) =>
          serializeAiUsageRow(row as unknown as Record<string, unknown>),
        )
        .filter(Boolean),
      count: rows.length,
    };
  }

  async summary(query: AiUsageFilterInput) {
    const match = buildAiUsageRawMatch(query);
    const [totals, byProvider, byFeature, byDay] = await Promise.all([
      this.aggregate([{ $match: match }, { $group: AI_USAGE_TOTALS_GROUP }]),
      this.aggregate([
        { $match: match },
        {
          $group: {
            _id: { provider: '$provider', billedModel: '$billedModel' },
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
      this.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$feature',
            calls: { $sum: 1 },
            costUsd: { $sum: '$costUsd' },
            totalTokens: { $sum: '$totalTokens' },
          },
        },
        { $sort: { costUsd: -1 } },
      ]),
      this.aggregate([{ $match: match }, ...AI_USAGE_BY_DAY_PIPELINE]),
    ]);

    return {
      totals: totals[0] ?? {
        ...EMPTY_AI_USAGE_TOTALS,
      },
      byProvider,
      byFeature,
      byDay,
    };
  }

  private async aggregate(
    pipeline: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const raw = await this.prisma.aiApiUsage.aggregateRaw({
      pipeline: pipeline as Prisma.InputJsonValue[],
    });
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }
}
