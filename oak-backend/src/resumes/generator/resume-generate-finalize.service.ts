import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  rawInsertOne,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { TITLE_POLICY_VERSION } from './constants/generator.constants';
import { cleanString } from './lib/clean-string';
import { configSnapshot } from './lib/config-snapshot';
import {
  computeTitlePolicyFingerprint,
  sourceCareers,
} from './lib/title-policy';
import type { PrepareGenerationOk } from './resume-generate-prepare.service';
import { ResumeGenerationLibraryService } from './resume-generation-library.service';
import { ResumeJobArtifactService } from './resume-job-artifact.service';

const GENERATIONS_COLLECTION = 'resume_generations';

@Injectable()
export class ResumeGenerateFinalizeService {
  private readonly logger = new Logger(ResumeGenerateFinalizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ResumeJobArtifactService,
    private readonly library: ResumeGenerationLibraryService,
  ) {}

  async finalize(input: {
    prep: PrepareGenerationOk;
    body: Record<string, unknown>;
    result: {
      sections: Record<string, unknown>;
      perStep: unknown;
      usage: unknown;
      coverageContract: unknown;
      isBeta?: boolean;
      dynamicCareerTitles?: boolean;
    };
    startedAt: Date;
    signal?: AbortSignal;
  }) {
    throwIfAborted(input.signal);
    const { prep, body, result, startedAt } = input;
    const skillProfile: unknown[] = [];
    const techStack: string | null = null;
    const skillAnalysisError: string | null = null;
    const isBeta = Boolean(prep.isBeta ?? result.isBeta);
    const dynamicCareerTitles = Boolean(
      prep.dynamicCareerTitles ?? result.dynamicCareerTitles,
    );
    const identity =
      body.identity && typeof body.identity === 'object'
        ? (body.identity as Record<string, unknown>)
        : null;
    const titlePolicyFingerprint = computeTitlePolicyFingerprint({
      dynamicCareerTitles,
      jobDescription: body.jobDescription,
      careers: sourceCareers(identity),
      config: body,
    });
    const identitySyncedAt =
      cleanString(body.identitySyncedAt) || new Date().toISOString();
    const applierName = cleanString(body.applierName) || prep.applierName;
    const finishedAt = new Date();
    const data = {
      applierName,
      provider: prep.providerId,
      model: prep.model,
      status: 'completed',
      backgroundTaskInputId: cleanString(body.backgroundTaskInputId) || null,
      config: configSnapshot({
        ...body,
        provider: prep.providerId,
        model: prep.model,
      }) as Prisma.InputJsonValue,
      identity: (identity ?? null) as Prisma.InputJsonValue,
      jobDescription: cleanString(body.jobDescription) || null,
      coverageAnalysis: ((body.coverage as { analysis?: unknown } | undefined)
        ?.analysis ?? null) as Prisma.InputJsonValue,
      coverageContract: (result.coverageContract ??
        null) as Prisma.InputJsonValue,
      sections: result.sections as Prisma.InputJsonValue,
      perStep: result.perStep as Prisma.InputJsonValue,
      usage: result.usage as Prisma.InputJsonValue,
      skillProfile: skillProfile as Prisma.InputJsonValue,
      techStack,
      skillAnalysisError,
      analyzed: false,
      analyzedAt: null,
      isBeta,
      dynamicCareerTitles,
      titlePolicyVersion: TITLE_POLICY_VERSION,
      titlePolicyFingerprint,
      identitySyncedAt,
      identityRefreshedAt: finishedAt,
      startedAt,
      finishedAt,
    };

    throwIfAborted(input.signal);
    const created = await withReplicaSetFallback(
      () => this.prisma.resumeGeneration.create({ data }),
      async () => {
        const now = new Date();
        await rawInsertOne(this.prisma, GENERATIONS_COLLECTION, {
          ...data,
          createdAt: now,
          updatedAt: now,
        });
        const row = await this.prisma.resumeGeneration.findFirst({
          where: {
            applierName,
            backgroundTaskInputId: data.backgroundTaskInputId,
            status: 'completed',
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!row) {
          throw new Error('Failed to load resume_generations after raw insert');
        }
        return row;
      },
    );

    throwIfAborted(input.signal);
    let resumeId: string | null = null;
    try {
      const parentJobId = cleanString(body.generateParentJobId) || null;
      const libraryInput = {
        generationId: created.id,
        ownerName: cleanString(body.applierName) || prep.applierName,
        profileId: prep.profileId,
        sections: result.sections,
        identity,
        templateId: cleanString(body.templateId) || null,
        config: body,
      };
      const row = parentJobId
        ? await this.artifacts.upsertFromGeneration({
            ...libraryInput,
            parentJobId,
          })
        : await this.library.upsertFromGeneration(libraryInput);
      resumeId = row?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `library sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      ...result,
      skillProfile,
      techStack,
      skillAnalysisError,
      generationId: created.id,
      resumeId,
      coverageContract: result.coverageContract ?? null,
      isBeta,
      dynamicCareerTitles,
      titlePolicyFingerprint,
      titlePolicyVersion: TITLE_POLICY_VERSION,
    };
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error('Resume generation cancelled'), {
    name: 'AbortError',
  });
}
