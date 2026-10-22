import { Injectable, Logger } from '@nestjs/common';
import type { File } from '@google-cloud/storage';
import { BID_RECORDINGS_PREFIX } from '../bids/constants/bid-status.constants';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { bidStorageSlug, storageSlug } from '../resumes/lib/storage-slug';
import type { AccountDeleteProgressFn } from './lib/account-delete-progress';
import { accountDeletePercent } from './lib/account-delete-progress';

const FILE_DELETE_BATCH = 8;

type StoragePrefix = {
  prefix: string;
  label: string;
};

/**
 * Firebase Storage cleanup for account wipe.
 * Resumes: `{storageSlug(name)}_{profileId}/`
 * Bid videos: `bid-recordings/{bidStorageSlug(name)}/`
 */
@Injectable()
export class AccountStorageCleanupService {
  private readonly logger = new Logger(AccountStorageCleanupService.name);

  constructor(private readonly admin: FirebaseAdminService) {}

  prefixesFor(applierName: string, profileId: string): StoragePrefix[] {
    const name = String(applierName || '').trim();
    const id = String(profileId || '').trim();
    if (!name || !id) return [];
    return [
      {
        prefix: `${storageSlug(name)}_${id}/`,
        label: 'Removing Firebase résumé files',
      },
      {
        prefix: `${BID_RECORDINGS_PREFIX}${bidStorageSlug(name)}/`,
        label: 'Removing Firebase bid recordings',
      },
    ];
  }

  async countAccountBlobs(input: {
    applierName: string;
    profileId: string;
  }): Promise<number> {
    const prefixes = this.prefixesFor(input.applierName, input.profileId);
    if (!prefixes.length) return 0;
    const bucket = this.admin.storageBucket();
    let total = 0;
    for (const { prefix } of prefixes) {
      const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
      total += files.length;
    }
    return total;
  }

  async deleteAccountBlobs(
    input: {
      applierName: string;
      profileId: string;
    },
    ctx?: {
      removed: number;
      total: number;
      onProgress?: AccountDeleteProgressFn;
    },
  ): Promise<number> {
    const prefixes = this.prefixesFor(input.applierName, input.profileId);
    if (!prefixes.length) return 0;

    const bucket = this.admin.storageBucket();
    let removedHere = 0;
    let removed = ctx?.removed ?? 0;
    const total = ctx?.total ?? 0;

    for (const { prefix, label } of prefixes) {
      let files: File[];
      try {
        [files] = await bucket.getFiles({ prefix, autoPaginate: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Storage list failed (${prefix}): ${message}`);
        throw new Error(
          `Failed to list account files from Storage (${prefix}): ${message}`,
        );
      }

      if (!files.length) {
        await ctx?.onProgress?.({
          phase: 'firebase',
          message: `${label}… none found`,
          removed,
          total,
          percent: accountDeletePercent(removed, total),
        });
        continue;
      }

      for (let offset = 0; offset < files.length; offset += FILE_DELETE_BATCH) {
        const batch = files.slice(offset, offset + FILE_DELETE_BATCH);
        try {
          await Promise.all(
            batch.map((file) => file.delete({ ignoreNotFound: true })),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Storage batch delete failed (${prefix}): ${message}`,
          );
          throw new Error(
            `Failed to delete account files from Storage (${prefix}): ${message}`,
          );
        }
        removedHere += batch.length;
        removed += batch.length;
        const doneInPrefix = Math.min(offset + batch.length, files.length);
        await ctx?.onProgress?.({
          phase: 'firebase',
          message: `${label}… ${doneInPrefix} of ${files.length} removed`,
          removed,
          total,
          percent: accountDeletePercent(removed, total),
        });
      }
    }

    return removedHere;
  }
}
