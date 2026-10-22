import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  rawInsertOne,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { normalizeCompanyKey } from '../lib/company-key';
import { ATHENS_METADATA_GLOBAL_KEY } from './constants/company-block.constants';
import {
  parseCompanyBlockRules,
  type CompanyBlockRule,
} from './mappers/company-block-rules.mapper';

const METADATA_COLLECTION = 'athens_metadata';

type MetadataSnapshot = {
  rules: CompanyBlockRule[];
  updatedAt: string | null;
  updatedBy: string | null;
};

/**
 * Persists company block rules on the global `athens_metadata` document.
 * In-process key cache is for ingest checks on the hot path.
 */
@Injectable()
export class CompanyBlockStoreService {
  private keys: Set<string> | null = null;
  private inflight: Promise<Set<string>> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  invalidate() {
    this.keys = null;
  }

  async isCompanyBlocked(companyName: string): Promise<boolean> {
    const key = normalizeCompanyKey(companyName);
    if (!key) return false;
    const keys = await this.loadKeys();
    return keys.has(key);
  }

  async read(): Promise<MetadataSnapshot> {
    const row = await this.prisma.athensMetadata.findUnique({
      where: { key: ATHENS_METADATA_GLOBAL_KEY },
    });
    const rules = parseCompanyBlockRules(row?.companyBlockRules);
    this.keys = new Set(rules.map((rule) => rule.companyKey));
    return {
      rules,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  async write(
    rules: CompanyBlockRule[],
    updatedBy: string,
  ): Promise<MetadataSnapshot> {
    const payload = rules as unknown as Prisma.InputJsonValue;
    const saved = await withReplicaSetFallback(
      () =>
        this.prisma.athensMetadata.upsert({
          where: { key: ATHENS_METADATA_GLOBAL_KEY },
          create: {
            key: ATHENS_METADATA_GLOBAL_KEY,
            companyBlockRules: payload,
            updatedBy,
          },
          update: { companyBlockRules: payload, updatedBy },
        }),
      () => this.writeRaw(payload, updatedBy),
    );
    this.keys = new Set(rules.map((rule) => rule.companyKey));
    return {
      rules: parseCompanyBlockRules(saved.companyBlockRules),
      updatedAt: saved.updatedAt.toISOString(),
      updatedBy: saved.updatedBy ?? null,
    };
  }

  private async loadKeys(): Promise<Set<string>> {
    if (this.keys) return this.keys;
    if (this.inflight) return this.inflight;
    this.inflight = this.read()
      .then((snap) => {
        this.keys = new Set(snap.rules.map((rule) => rule.companyKey));
        return this.keys;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async writeRaw(
    payload: Prisma.InputJsonValue,
    updatedBy: string,
  ): Promise<{
    companyBlockRules: Prisma.JsonValue;
    updatedAt: Date;
    updatedBy: string | null;
  }> {
    const now = new Date();
    const existing = await this.prisma.athensMetadata.findUnique({
      where: { key: ATHENS_METADATA_GLOBAL_KEY },
      select: { id: true },
    });
    if (existing) {
      await rawUpdateMany(
        this.prisma,
        METADATA_COLLECTION,
        { key: ATHENS_METADATA_GLOBAL_KEY },
        {
          companyBlockRules: payload,
          updatedBy,
          updatedAt: now,
        },
      );
    } else {
      await rawInsertOne(this.prisma, METADATA_COLLECTION, {
        key: ATHENS_METADATA_GLOBAL_KEY,
        companyBlockRules: payload,
        updatedBy,
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      companyBlockRules: payload as Prisma.JsonValue,
      updatedAt: now,
      updatedBy,
    };
  }
}
