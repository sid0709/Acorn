import { Injectable, NotFoundException } from '@nestjs/common';
import type { Resume } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  parentJobIdFromAnalysis,
  resumeParentJobId,
} from './lib/parent-job-id';

/**
 * Which jobs already have a generated résumé for this applier.
 */
@Injectable()
export class AgentJobResumesService {
  constructor(private readonly prisma: PrismaService) {}

  async status(applierName: string, jobIdsRaw: string[]) {
    const name = String(applierName || '').trim();
    const jobIds = [
      ...new Set(
        (Array.isArray(jobIdsRaw) ? jobIdsRaw : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    ].slice(0, 500);

    if (!name || !jobIds.length) {
      return { success: true as const, jobIds: [] as string[] };
    }

    const wanted = new Set(jobIds);
    const [indexed, legacy] = await Promise.all([
      this.prisma.resume.findMany({
        where: { ownerName: name, parentJobId: { in: jobIds } },
        select: { parentJobId: true },
      }),
      this.prisma.resume.findMany({
        where: { ownerName: name, source: 'generated', parentJobId: null },
        select: { generationId: true, analysis: true },
        take: 2000,
      }),
    ]);

    const found = new Set<string>();
    for (const row of indexed) {
      if (row.parentJobId && wanted.has(row.parentJobId)) {
        found.add(row.parentJobId);
      }
    }
    for (const row of legacy) {
      if (row.generationId && wanted.has(row.generationId)) {
        found.add(row.generationId);
      }
      const parent = parentJobIdFromAnalysis(row.analysis);
      if (parent && wanted.has(parent)) found.add(parent);
    }

    return { success: true as const, jobIds: [...found] };
  }

  async findGeneratedForJob(
    applierName: string,
    jobId: string,
  ): Promise<Resume | null> {
    const name = String(applierName || '').trim();
    const id = String(jobId || '').trim();
    if (!name || !id) return null;

    const byField = await this.prisma.resume.findFirst({
      where: { ownerName: name, parentJobId: id },
    });
    if (byField) return byField;

    const generated = await this.prisma.resume.findMany({
      where: { ownerName: name, source: 'generated' },
      take: 2000,
    });
    return (
      generated.find((row) => resumeParentJobId(row) === id) ||
      generated.find((row) => String(row.generationId || '').trim() === id) ||
      null
    );
  }

  requireGeneratedForJob(applierName: string, jobId: string): Promise<Resume> {
    return this.findGeneratedForJob(applierName, jobId).then((row) => {
      if (row) return row;
      throw new NotFoundException({
        success: false,
        error: 'Generated résumé not found for this job',
      });
    });
  }
}
