import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  deleteManyWithFallback,
  mongoIdQuery,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeService } from '../resume.service';
import { cleanString } from './lib/clean-string';
import { resumeDownloadFileName } from './lib/resume-file-name';
import { ResumeJobDocxService } from './resume-job-docx.service';

const GENERATIONS_COLLECTION = 'resume_generations';

@Injectable()
export class ResumeGenerationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumes: ResumeService,
    private readonly docx: ResumeJobDocxService,
  ) {}

  async list(query: Record<string, string | undefined>) {
    const applierName = cleanString(query.applierName);
    if (!applierName) {
      return {
        success: true as const,
        runs: [],
        total: 0,
        limit: 20,
        offset: 0,
      };
    }

    const limit = Math.max(
      1,
      Math.min(100, parseInt(query.limit || '20', 10) || 20),
    );
    const offset = Math.max(0, parseInt(query.offset || '0', 10) || 0);
    const where = buildFilter(query, applierName);
    const orderBy = buildSort(query.sort);

    const [total, rows, facets] = await Promise.all([
      this.prisma.resumeGeneration.count({ where }),
      this.prisma.resumeGeneration.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
      }),
      query.includeFacets === '1'
        ? this.loadFacets(applierName)
        : Promise.resolve(null),
    ]);

    return {
      success: true as const,
      runs: rows.map(mapRun),
      total,
      limit,
      offset,
      ...(facets ? { facets } : {}),
    };
  }

  async get(idRaw: string, applierNameRaw?: string) {
    const id = cleanString(idRaw);
    if (!id) {
      throw new BadRequestException({
        success: false,
        error: 'id is required',
      });
    }
    const applierName = cleanString(applierNameRaw);
    const run = await this.prisma.resumeGeneration.findFirst({
      where: applierName ? { id, applierName } : { id },
    });
    if (!run) {
      throw new NotFoundException({ success: false, error: 'Run not found' });
    }
    return { success: true as const, run: mapRun(run) };
  }

  async delete(idRaw: string, applierNameRaw: string) {
    const id = cleanString(idRaw);
    const applierName = cleanString(applierNameRaw);
    if (!id) {
      throw new BadRequestException({
        success: false,
        error: 'id is required',
      });
    }
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }

    const run = await this.prisma.resumeGeneration.findFirst({
      where: { id, applierName },
    });
    if (!run) {
      throw new NotFoundException({
        success: false,
        error: 'Generation run not found',
      });
    }

    let resumeDeleted = false;
    const linked = await this.prisma.resume.findFirst({
      where: { generationId: id, ownerName: applierName },
    });
    if (linked) {
      await this.resumes.delete(linked.id, applierName);
      resumeDeleted = true;
    }

    await deleteManyWithFallback(
      this.prisma,
      GENERATIONS_COLLECTION,
      mongoIdQuery(id),
      async () => {
        await this.prisma.resumeGeneration.delete({ where: { id } });
        return { count: 1 };
      },
    );
    return { success: true as const, deleted: true, resumeDeleted };
  }

  async renderDocx(idRaw: string, applierNameRaw?: string) {
    const id = cleanString(idRaw);
    if (!id) {
      throw new BadRequestException({
        success: false,
        error: 'id is required',
      });
    }
    const applierName = cleanString(applierNameRaw);
    const run = await this.prisma.resumeGeneration.findFirst({
      where: applierName ? { id, applierName } : { id },
    });
    if (!run?.sections || typeof run.sections !== 'object') {
      throw new NotFoundException({
        success: false,
        error: 'Generated résumé not found',
      });
    }
    const identity =
      run.identity && typeof run.identity === 'object'
        ? (run.identity as Record<string, unknown>)
        : {};
    const config =
      run.config && typeof run.config === 'object'
        ? (run.config as Record<string, unknown>)
        : {};
    const ownerName = applierName || cleanString(run.applierName);
    const buffer = await this.docx.render({
      ownerName,
      templateId: cleanString(config.templateId) || null,
      sections: run.sections as Record<string, unknown>,
      identity,
      config,
    });
    const fileName = resumeDownloadFileName(
      cleanString(identity.fullName) ||
        cleanString(run.applierName) ||
        'Resume',
    );
    return { buffer, fileName };
  }

  private async loadFacets(applierName: string) {
    const base = { applierName };
    const [models, providers, statusRows, completed] = await Promise.all([
      this.prisma.resumeGeneration.findMany({
        where: base,
        distinct: ['model'],
        select: { model: true },
      }),
      this.prisma.resumeGeneration.findMany({
        where: base,
        distinct: ['provider'],
        select: { provider: true },
      }),
      this.prisma.resumeGeneration.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
      this.prisma.resumeGeneration.findMany({
        where: { ...base, status: 'completed' },
        select: { usage: true },
      }),
    ]);

    const statusCounts = { completed: 0, failed: 0 };
    for (const row of statusRows) {
      if (row.status === 'completed' || row.status === 'failed') {
        statusCounts[row.status] = row._count._all;
      }
    }

    let totalTokens = 0;
    let totalCost = 0;
    for (const row of completed) {
      const usage =
        row.usage && typeof row.usage === 'object'
          ? (row.usage as { totalTokens?: number; cost?: number })
          : {};
      totalTokens += Number(usage.totalTokens || 0);
      totalCost += Number(usage.cost || 0);
    }

    return {
      models: models
        .map((m) => m.model)
        .filter(Boolean)
        .sort() as string[],
      providers: providers
        .map((p) => p.provider)
        .filter(Boolean)
        .sort() as string[],
      templates: [] as string[],
      statusCounts,
      stats: {
        completed: completed.length,
        totalTokens,
        totalCost,
      },
    };
  }
}

function buildFilter(
  query: Record<string, string | undefined>,
  applierName: string,
): Prisma.ResumeGenerationWhereInput {
  const where: Prisma.ResumeGenerationWhereInput = { applierName };
  const status = cleanString(query.status) || 'all';
  if (status !== 'all') where.status = status;
  const model = cleanString(query.model);
  if (model) where.model = model;
  const provider = cleanString(query.provider);
  if (provider) where.provider = provider;

  const fromRaw = cleanString(query.from);
  const toRaw = cleanString(query.to);
  if (fromRaw || toRaw) {
    where.startedAt = {};
    if (fromRaw) {
      const from = new Date(fromRaw);
      if (!Number.isNaN(from.getTime())) where.startedAt.gte = from;
    }
    if (toRaw) {
      const to = new Date(toRaw);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        where.startedAt.lte = to;
      }
    }
  }

  const search = cleanString(query.search || query.q);
  if (search) {
    where.jobDescription = { contains: search };
  }
  return where;
}

function buildSort(
  sortKey: string | undefined,
): Prisma.ResumeGenerationOrderByWithRelationInput[] {
  switch (cleanString(sortKey)) {
    case 'oldest':
      return [{ startedAt: 'asc' }];
    default:
      return [{ startedAt: 'desc' }];
  }
}

function mapRun<T extends { id: string }>(run: T) {
  return { ...run, _id: run.id };
}
