import { Injectable } from '@nestjs/common';
import { AccountInfo, Prisma } from '@prisma/client';
import {
  isReplicaSetRequired,
  mongoIdQuery,
  toMongoJson,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Must match `@@map("account_info")` on AccountInfo in prisma/schema.prisma.
 * Used only for $runCommandRaw fallbacks on standalone Mongo.
 */
const ACCOUNT_INFO_COLLECTION = 'account_info';

/**
 * Persistence for AccountInfo via PrismaService.
 * Standalone Mongo cannot run Prisma transactional writes; create/update
 * fall back to $runCommandRaw here only (§5 raw-in-one-place).
 */
@Injectable()
export class AccountInfoRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve by `_id`. Legacy Athens-server rows store `_id` as a plain string;
   * Prisma `@db.ObjectId` findUnique misses those, so fall back via name.
   */
  async findById(id: string): Promise<AccountInfo | null> {
    const trimmed = String(id || '').trim();
    if (!trimmed) return null;

    const byObjectId = await this.prisma.accountInfo.findUnique({
      where: { id: trimmed },
    });
    if (byObjectId) return byObjectId;

    const raw = await this.prisma.$runCommandRaw({
      find: ACCOUNT_INFO_COLLECTION,
      filter: mongoIdQuery(trimmed),
      limit: 1,
      projection: { name: 1 },
    });
    const doc = (raw as { cursor?: { firstBatch?: Array<{ name?: unknown }> } })
      .cursor?.firstBatch?.[0];
    const name = typeof doc?.name === 'string' ? doc.name.trim() : '';
    if (!name) return null;
    return this.prisma.accountInfo.findUnique({ where: { name } });
  }

  findByExactName(name: string): Promise<AccountInfo | null> {
    return this.prisma.accountInfo.findUnique({ where: { name } });
  }

  findByUsernameKey(usernameKey: string): Promise<AccountInfo | null> {
    return this.prisma.accountInfo.findFirst({ where: { usernameKey } });
  }

  listOrderedByName(): Promise<AccountInfo[]> {
    return this.prisma.accountInfo.findMany({ orderBy: { name: 'asc' } });
  }

  listByUserStatus(userStatus: string): Promise<AccountInfo[]> {
    return this.prisma.accountInfo.findMany({
      where: { userStatus },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: {
    name: string;
    usernameKey: string;
    password: string;
    userStatus?: string;
  }): Promise<AccountInfo> {
    try {
      return await this.prisma.accountInfo.create({ data });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await this.prisma.$runCommandRaw({
        insert: ACCOUNT_INFO_COLLECTION,
        documents: [data],
        ordered: true,
      });
      const created = await this.findByExactName(data.name);
      if (!created) throw new Error('Failed to load created account');
      return created;
    }
  }

  async updatePassword(id: string, password: string): Promise<void> {
    await this.updateFields(id, { password });
  }

  async updateVendorPassword(
    id: string,
    vendorPassword: string | null,
  ): Promise<void> {
    await this.updateFields(id, { vendorPassword });
  }

  async updateName(
    id: string,
    name: string,
    usernameKey: string,
  ): Promise<void> {
    await this.updateFields(id, { name, usernameKey });
  }

  async updateUserStatus(id: string, userStatus: string): Promise<void> {
    await this.updateFields(id, { userStatus });
  }

  async deleteById(id: string): Promise<void> {
    const trimmed = String(id || '').trim();
    if (!trimmed) return;
    try {
      await this.prisma.accountInfo.delete({ where: { id: trimmed } });
    } catch (error) {
      if (!isReplicaSetRequired(error)) {
        // Legacy string `_id` or already absent — raw path covers both.
        await this.rawDeleteById(trimmed);
        return;
      }
      const matched = await this.rawDeleteById(trimmed);
      if (matched < 1) {
        throw new Error(`Account delete matched 0 documents for id=${trimmed}`);
      }
    }
  }

  private async rawDeleteById(id: string): Promise<number> {
    const result = await this.prisma.$runCommandRaw({
      delete: ACCOUNT_INFO_COLLECTION,
      deletes: [{ q: mongoIdQuery(id), limit: 1 }],
    });
    return Number((result as { n?: number }).n ?? 0);
  }

  async updateByName(
    name: string,
    data: Prisma.AccountInfoUpdateInput,
  ): Promise<boolean> {
    const acc = await this.findByExactName(String(name || '').trim());
    if (!acc) return false;
    await this.updateFields(acc.id, data);
    return true;
  }

  async updateAutoBidProfile(
    id: string,
    autoBidProfile: Prisma.InputJsonValue,
    vendorAllowed: boolean,
  ): Promise<void> {
    await this.updateFields(id, { autoBidProfile, vendorAllowed });
  }

  /** Merge a few autoBidProfile fields without clobbering the rest. */
  async patchAutoBidProfileFields(
    id: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const current = await this.findById(id);
    if (!current) return;
    const base =
      current.autoBidProfile &&
      typeof current.autoBidProfile === 'object' &&
      !Array.isArray(current.autoBidProfile)
        ? { ...(current.autoBidProfile as Record<string, unknown>) }
        : {};
    const autoBidProfile = {
      ...base,
      ...fields,
    } as Prisma.InputJsonValue;
    await this.updateFields(id, { autoBidProfile });
  }

  private async updateFields(
    id: string,
    data: Prisma.AccountInfoUpdateInput,
  ): Promise<void> {
    try {
      await this.prisma.accountInfo.update({ where: { id }, data });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      const matched = await this.rawUpdateById(id, data);
      if (matched < 1) {
        throw new Error(`Account update matched 0 documents for id=${id}`);
      }
    }
  }

  private async rawUpdateById(
    id: string,
    data: Prisma.AccountInfoUpdateInput,
  ): Promise<number> {
    const result = await this.prisma.$runCommandRaw({
      update: ACCOUNT_INFO_COLLECTION,
      updates: [
        {
          q: mongoIdQuery(id),
          u: { $set: toMongoJson(data) },
          multi: false,
        },
      ],
    });
    return Number((result as { n?: number }).n ?? 0);
  }
}
