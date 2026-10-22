import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PrenormTempJobInput } from './mappers/prenorm-scrape.mapper';
import { CompanyBlockStoreService } from './company-block/company-block-store.service';
import {
  COMPANY_BLOCKED_CODE,
  COMPANY_BLOCKED_REASON,
} from './company-block/constants/company-block.constants';
import { JobDedupeService } from './job-dedupe.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  rawInsertOne,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';

export type SaveJobResult =
  | {
      success: true;
      created: true;
      duplicate: false;
      blocked?: false;
      id: string;
      jobID?: string;
      jobLink?: string;
      source?: string;
    }
  | {
      success: true;
      created: false;
      duplicate: true;
      blocked?: false;
      id?: string;
      jobID?: string;
      jobLink?: string;
      reason: string;
      code?: string;
    }
  | {
      success: true;
      created: false;
      duplicate: false;
      blocked: true;
      reason: string;
      code: typeof COMPANY_BLOCKED_CODE;
      jobID?: string;
      jobLink?: string;
    };

const TEMP_JOBS_COLLECTION = 'temp_jobs';

function legacyIdFrom(data: PrenormTempJobInput): string | undefined {
  const meta = data.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta))
    return undefined;
  const legacyId = (meta as { legacyId?: unknown }).legacyId;
  return typeof legacyId === 'string' && legacyId.trim()
    ? legacyId.trim()
    : undefined;
}

function newObjectIdHex(): string {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  const rest = randomBytes(8).toString('hex');
  return `${time}${rest}`;
}

@Injectable()
export class SaveJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dedupe: JobDedupeService,
    private readonly companyBlocks: CompanyBlockStoreService,
  ) {}

  /**
   * Prenorm → dedupe (temp_jobs + jobs) → create TempJob.
   * Duplicates return success with `duplicate: true` (Extension / LI-scrapper contract).
   */
  async save(data: PrenormTempJobInput): Promise<SaveJobResult> {
    const legacyId = legacyIdFrom(data);
    const applyLink =
      typeof data.applyLink === 'string' && data.applyLink.trim()
        ? data.applyLink.trim()
        : undefined;

    if (await this.companyBlocks.isCompanyBlocked(data.companyName)) {
      return {
        success: true,
        created: false,
        duplicate: false,
        blocked: true,
        ...(legacyId ? { jobID: legacyId } : {}),
        ...(applyLink ? { jobLink: applyLink } : {}),
        reason: COMPANY_BLOCKED_REASON,
        code: COMPANY_BLOCKED_CODE,
      };
    }

    const duplicate = await this.dedupe.findDuplicate({
      legacyId,
      applyLink,
      companyName: data.companyName,
      title: data.title,
    });
    if (duplicate) {
      return {
        success: true,
        created: false,
        duplicate: true,
        id: duplicate.id,
        ...(legacyId ? { jobID: legacyId } : {}),
        ...(applyLink ? { jobLink: applyLink } : {}),
        reason: duplicate.reason,
        code: duplicate.code,
      };
    }

    const created = await withReplicaSetFallback(
      () => this.prisma.tempJob.create({ data }),
      async () => {
        const id = newObjectIdHex();
        const now = new Date();
        await rawInsertOne(this.prisma, TEMP_JOBS_COLLECTION, {
          _id: { $oid: id },
          title: data.title,
          companyName: data.companyName,
          ...(data.companyId
            ? { companyId: { $oid: String(data.companyId) } }
            : {}),
          source: data.source,
          postedAt: data.postedAt,
          ...(data.postedAgo ? { postedAgo: data.postedAgo } : {}),
          titleReviewLabel: data.titleReviewLabel,
          sourceCatalog: data.sourceCatalog ?? 'market',
          ...(data.companyLink ? { companyLink: data.companyLink } : {}),
          ...(applyLink ? { applyLink } : {}),
          ...(data.description ? { description: data.description } : {}),
          ...(data.aiSkills != null ? { aiSkills: data.aiSkills } : {}),
          ...(data.aiSkillStatus ? { aiSkillStatus: data.aiSkillStatus } : {}),
          model_schema_code: data.modelSchemaCode,
          createdBy: data.createdBy,
          createdAt: now,
          updatedAt: now,
          ...(data.metadata != null ? { metadata: data.metadata } : {}),
        });
        return {
          id,
          applyLink: applyLink ?? null,
          source: data.source,
        };
      },
    );

    return {
      success: true,
      created: true,
      duplicate: false,
      id: created.id,
      ...(legacyId ? { jobID: legacyId } : {}),
      ...(created.applyLink ? { jobLink: created.applyLink } : {}),
      source: created.source,
    };
  }

  async existsByLegacyId(jobID: string): Promise<boolean> {
    return this.dedupe.existsByLegacyId(jobID);
  }
}
