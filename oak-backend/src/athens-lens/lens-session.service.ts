import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  rawDeleteMany,
  rawInsertOne,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';

/** Must match `@@map("athens_lens_sessions")` on AthensLensSession. */
const SESSIONS_COLLECTION = 'athens_lens_sessions';

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const MIN_TTL = 5 * 60;
const MAX_TTL = 7 * 24 * 60 * 60;

export type LensPublicSession = {
  accountId: string;
  profileId: string;
  applierName: string;
  username: string;
  authenticatedAt: string;
  expiresAt: string;
};

function sessionTtlSeconds(): number {
  const configured = Number.parseInt(
    String(process.env.ATHENS_LENS_SESSION_TTL_SECONDS || ''),
    10,
  );
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, configured));
}

function tokenId(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

@Injectable()
export class LensSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    accountId: string;
    profileId?: string;
    applierName: string;
    username: string;
  }): Promise<{ token: string; session: LensPublicSession }> {
    const token = randomBytes(32).toString('base64url');
    const id = tokenId(token);
    const authenticatedAt = new Date();
    const expiresAt = new Date(
      authenticatedAt.getTime() + sessionTtlSeconds() * 1000,
    );
    const profileId = input.profileId || input.accountId;
    const now = new Date();

    await withReplicaSetFallback(
      async () => {
        await this.prisma.athensLensSession.create({
          data: {
            id,
            accountId: input.accountId,
            profileId,
            applierName: input.applierName,
            username: input.username,
            authenticatedAt,
            expiresAt,
          },
        });
      },
      () =>
        rawInsertOne(this.prisma, SESSIONS_COLLECTION, {
          _id: id,
          accountId: input.accountId,
          profileId,
          applierName: input.applierName,
          username: input.username,
          authenticatedAt,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        }),
    );

    return {
      token,
      session: {
        accountId: input.accountId,
        profileId,
        applierName: input.applierName,
        username: input.username,
        authenticatedAt: authenticatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async read(token: string): Promise<LensPublicSession | null> {
    const normalized = String(token || '').trim();
    if (!normalized) return null;
    const id = tokenId(normalized);
    const row = await this.prisma.athensLensSession.findUnique({
      where: { id },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.deleteById(id);
      return null;
    }
    return {
      accountId: row.accountId,
      profileId: row.profileId,
      applierName: row.applierName,
      username: row.username,
      authenticatedAt: row.authenticatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async revoke(token: string): Promise<void> {
    const normalized = String(token || '').trim();
    if (!normalized) return;
    await this.deleteById(tokenId(normalized));
  }

  private async deleteById(id: string): Promise<void> {
    await withReplicaSetFallback(
      async () => {
        await this.prisma.athensLensSession
          .delete({ where: { id } })
          .catch(() => undefined);
      },
      async () => {
        await rawDeleteMany(this.prisma, SESSIONS_COLLECTION, { _id: id });
      },
    );
  }
}
