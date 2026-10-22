import { Injectable } from '@nestjs/common';
import { BID_RECORDINGS_PREFIX } from '../bids/constants/bid-status.constants';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { bidStorageSlug, storageSlug } from '../resumes/lib/storage-slug';

const COPY_BATCH = 8;

export type StorageRenamePlan = {
  resumeFrom: string;
  resumeTo: string;
  recordingFrom: string;
  recordingTo: string;
};

export function storageRenamePlan(
  oldName: string,
  newName: string,
  profileId: string,
): StorageRenamePlan {
  const id = String(profileId || '').trim();
  return {
    resumeFrom: `${storageSlug(oldName)}_${id}/`,
    resumeTo: `${storageSlug(newName)}_${id}/`,
    recordingFrom: `${BID_RECORDINGS_PREFIX}${bidStorageSlug(oldName)}/`,
    recordingTo: `${BID_RECORDINGS_PREFIX}${bidStorageSlug(newName)}/`,
  };
}

/** Copy Firebase objects from the old username prefixes to the new ones. */
@Injectable()
export class AccountStorageRenameService {
  constructor(private readonly admin: FirebaseAdminService) {}

  async copyPrefixes(plan: StorageRenamePlan): Promise<void> {
    await this.copyPrefix(plan.resumeFrom, plan.resumeTo);
    await this.copyPrefix(plan.recordingFrom, plan.recordingTo);
  }

  async deletePrefixes(plan: StorageRenamePlan): Promise<void> {
    await this.deletePrefix(plan.resumeFrom, plan.resumeTo);
    await this.deletePrefix(plan.recordingFrom, plan.recordingTo);
  }

  private async copyPrefix(from: string, to: string): Promise<void> {
    if (!from || from === to) return;
    const files = await this.list(from);
    for (let offset = 0; offset < files.length; offset += COPY_BATCH) {
      const batch = files.slice(offset, offset + COPY_BATCH);
      await Promise.all(
        batch.map(async (name) => {
          const dest = `${to}${name.slice(from.length)}`;
          if (dest === name) return;
          await this.admin.storageBucket().file(name).copy(dest);
        }),
      );
    }
  }

  private async deletePrefix(from: string, to: string): Promise<void> {
    if (!from || from === to) return;
    const files = await this.list(from);
    for (let offset = 0; offset < files.length; offset += COPY_BATCH) {
      const batch = files.slice(offset, offset + COPY_BATCH);
      await Promise.all(
        batch.map((name) =>
          this.admin
            .storageBucket()
            .file(name)
            .delete({ ignoreNotFound: true }),
        ),
      );
    }
  }

  private async list(prefix: string): Promise<string[]> {
    const [files] = await this.admin
      .storageBucket()
      .getFiles({ prefix, autoPaginate: true });
    return files.map((file) => file.name).filter(Boolean);
  }
}
