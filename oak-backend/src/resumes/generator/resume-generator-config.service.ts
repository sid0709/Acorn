import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccountInfoService } from '../../auth/account-info.service';
import {
  mongoIdQuery,
  rawInsertOne,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanString } from './lib/clean-string';
import { migrateGeneratorConfig } from './lib/migrate-generator-config';

const CONFIG_COLLECTION = 'resume_generator_config';

type ConfigRow = {
  id: string;
  applierName: string;
  profileId: string | null;
  config: Prisma.JsonValue;
  updatedAt: Date;
};

@Injectable()
export class ResumeGeneratorConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
  ) {}

  async get(applierNameRaw: string) {
    const applierName = cleanString(applierNameRaw);
    if (!applierName) {
      return { success: true as const, config: null };
    }

    const resolved = await this.loadRecord(applierName);
    const doc = resolved?.record ?? null;
    if (!doc) {
      return {
        success: true as const,
        config: null,
        updatedAt: null,
        source: null,
        migration: null,
        legacyJobDescription: null,
      };
    }

    const migration = migrateGeneratorConfig(doc.config);
    if (migration.migrated) {
      await this.persistConfig(doc.id, {
        config: migration.config as Prisma.InputJsonValue,
      });
    }

    return {
      success: true as const,
      config: migration.config,
      updatedAt: doc.updatedAt?.toISOString?.() ?? null,
      source: resolved?.source ?? null,
      migration: migration.migrated
        ? { from: migration.sourceVersion, to: 4 }
        : null,
      legacyJobDescription: migration.legacyJobDescription ?? null,
    };
  }

  async save(applierNameRaw: string, configRaw: unknown, profileId?: string) {
    const applierName = cleanString(applierNameRaw);
    const migration = migrateGeneratorConfig(
      configRaw && typeof configRaw === 'object' ? configRaw : {},
    );
    const account = await this.accounts.findByName(applierName);
    const resolvedProfileId = cleanString(profileId) || account?.id || null;

    const existing = await this.prisma.resumeGeneratorConfig.findFirst({
      where: { applierName },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      await this.persistConfig(existing.id, {
        config: migration.config as Prisma.InputJsonValue,
        ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
      });
    } else {
      await this.createConfig({
        applierName,
        profileId: resolvedProfileId,
        config: migration.config as Prisma.InputJsonValue,
      });
    }

    return { success: true as const, schemaVersion: 4 as const };
  }

  private async persistConfig(
    id: string,
    data: {
      config: Prisma.InputJsonValue;
      profileId?: string;
    },
  ) {
    await withReplicaSetFallback(
      () =>
        this.prisma.resumeGeneratorConfig.update({
          where: { id },
          data,
        }),
      async () => {
        await rawUpdateMany(this.prisma, CONFIG_COLLECTION, mongoIdQuery(id), {
          ...data,
          updatedAt: new Date(),
        });
        return null;
      },
    );
  }

  private async createConfig(input: {
    applierName: string;
    profileId: string | null;
    config: Prisma.InputJsonValue;
  }) {
    const now = new Date();
    await withReplicaSetFallback(
      () =>
        this.prisma.resumeGeneratorConfig.create({
          data: {
            applierName: input.applierName,
            profileId: input.profileId,
            config: input.config,
          },
        }),
      async () => {
        await rawInsertOne(this.prisma, CONFIG_COLLECTION, {
          applierName: input.applierName,
          profileId: input.profileId,
          config: input.config,
          createdAt: now,
          updatedAt: now,
        });
        return null;
      },
    );
  }

  private async loadRecord(applierName: string) {
    const account = await this.accounts
      .findByName(applierName)
      .catch(() => null);
    const email = profileEmail(account?.autoBidProfile);
    const aliases = [
      ...new Set(
        [applierName, account?.name, email].map(cleanString).filter(Boolean),
      ),
    ];
    const profileId = account?.id ?? null;

    const records = await this.prisma.resumeGeneratorConfig.findMany({
      where: {
        OR: [
          { applierName: { in: aliases } },
          ...(profileId ? [{ profileId }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    return selectConfigRecord(records, {
      applierName: account?.name || applierName,
      profileId,
    });
  }
}

function profileEmail(profile: unknown): string {
  if (!profile || typeof profile !== 'object') return '';
  return cleanString((profile as { email?: unknown }).email);
}

/** Prefer exact applierName match, else profileId. Newest first. */
function selectConfigRecord(
  records: ConfigRow[],
  opts: { applierName: string; profileId: string | null },
): { record: ConfigRow; source: string } | null {
  if (!records.length) return null;
  const exact = records.filter(
    (r) =>
      r.applierName.localeCompare(opts.applierName, 'en-US', {
        sensitivity: 'accent',
      }) === 0,
  );
  if (exact.length) return { record: exact[0], source: 'applier-name' };
  if (opts.profileId) {
    const byProfile = records.filter((r) => r.profileId === opts.profileId);
    if (byProfile.length) {
      return { record: byProfile[0], source: 'profile-id' };
    }
  }
  return { record: records[0], source: 'legacy-alias' };
}
