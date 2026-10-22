import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  rawDeleteMany,
  rawInsertOne,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OAK_SESSIONS_COLLECTION,
  oakSessionTtlSeconds,
} from '../constants/oak.constants';

export type OakPublicSession = {
  accountId: string;
  profileId: string;
  applierName: string;
  username: string;
  authenticatedAt: string;
  expiresAt: string;
};

function tokenId(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

@Injectable()
export class OakSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    accountId: string;
    profileId?: string;
    applierName: string;
    username: string;
  }): Promise<{ token: string; session: OakPublicSession }> {
    const token = randomBytes(32).toString('base64url');
    const id = tokenId(token);
    const authenticatedAt = new Date();
    const expiresAt = new Date(
      authenticatedAt.getTime() + oakSessionTtlSeconds() * 1000,
    );
    const profileId = input.profileId || input.accountId;
    const now = new Date();

    await withReplicaSetFallback(
      async () => {
        await this.prisma.oakSession.create({
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
        rawInsertOne(this.prisma, OAK_SESSIONS_COLLECTION, {
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

  async read(token: string): Promise<OakPublicSession | null> {
    const normalized = String(token || '').trim();
    if (!normalized) return null;
    const id = tokenId(normalized);
    const row = await this.prisma.oakSession.findUnique({ where: { id } });
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
        await this.prisma.oakSession
          .delete({ where: { id } })
          .catch(() => undefined);
      },
      async () => {
        await rawDeleteMany(this.prisma, OAK_SESSIONS_COLLECTION, { _id: id });
      },
    );
  }
}
