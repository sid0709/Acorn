import { Injectable, Logger } from '@nestjs/common';
import type { AccountInfo } from '@prisma/client';
import { AccountDataPurgeService } from './account-data-purge.service';
import { AccountInfoRepository } from './account-info.repository';
import { AccountStorageCleanupService } from './account-storage-cleanup.service';
import type { AccountDeleteProgressFn } from './lib/account-delete-progress';
import { accountDeletePercent } from './lib/account-delete-progress';

/**
 * Full account wipe: Storage blobs, then applier-owned Mongo rows, then AccountInfo.
 * Does not touch shared job/company catalogs.
 */
@Injectable()
export class AccountCascadeDeleteService {
  private readonly logger = new Logger(AccountCascadeDeleteService.name);

  constructor(
    private readonly accounts: AccountInfoRepository,
    private readonly storage: AccountStorageCleanupService,
    private readonly dataPurge: AccountDataPurgeService,
  ) {}

  async deleteAccount(
    account: AccountInfo,
    onProgress?: AccountDeleteProgressFn,
  ): Promise<void> {
    const profileId = String(account.id || '').trim();
    const applierName = String(account.name || '').trim();
    if (!profileId || !applierName) {
      throw new Error('Account is missing id or name');
    }

    this.logger.log(
      `Cascade delete starting for applier=${applierName} profileId=${profileId}`,
    );

    await onProgress?.({
      phase: 'preparing',
      message: 'Preparing deletion… counting your data',
      removed: 0,
      total: 0,
      percent: 0,
    });

    const [storageTotal, dataTotal] = await Promise.all([
      this.storage.countAccountBlobs({ applierName, profileId }),
      this.dataPurge.countOwnedRows(profileId, applierName),
    ]);
    const total = storageTotal + dataTotal + 1; // + account row
    let removed = 0;

    await onProgress?.({
      phase: 'preparing',
      message:
        total > 1
          ? `Prepared — ${total.toLocaleString()} items to remove`
          : 'Prepared — removing account',
      removed: 0,
      total,
      percent: 0,
    });

    removed += await this.storage.deleteAccountBlobs(
      { applierName, profileId },
      { removed, total, onProgress },
    );

    removed += await this.dataPurge.purgeOwnedRows(profileId, applierName, {
      removed,
      total,
      onProgress,
    });

    await onProgress?.({
      phase: 'account',
      message: 'Removing account record…',
      removed,
      total,
      percent: accountDeletePercent(removed, total),
    });
    await this.accounts.deleteById(profileId);
    removed += 1;

    await onProgress?.({
      phase: 'done',
      message: 'Account deleted',
      removed,
      total,
      percent: 100,
    });

    this.logger.log(`Cascade delete finished for applier=${applierName}`);
  }
}
