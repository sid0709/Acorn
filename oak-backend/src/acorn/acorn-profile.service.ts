import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ACORN_PROFILES_COLLECTION,
  ACORN_PROFILE_SECRET_FIELDS,
} from './acorn.constants';
import { AcornDbService } from './acorn-db.service';

type StoredProfile = { accountId: string; profile?: Record<string, unknown> };

/** The account profile the Acorn website edits (`acorn_profiles`). */
@Injectable()
export class AcornProfileService {
  constructor(private readonly db: AcornDbService) {}

  async load(accountId: string): Promise<Record<string, unknown>> {
    const profiles = await this.db.collection<StoredProfile>(
      ACORN_PROFILES_COLLECTION,
    );
    const row = await profiles.findOne({ accountId });
    if (!row) {
      throw new NotFoundException({
        success: false,
        message:
          'No Acorn profile for this account. Fill it in on the website.',
      });
    }
    return row.profile ?? {};
  }

  /** The profile without passwords, keys and local paths — safe to put in a prompt. */
  async loadForPrompt(accountId: string): Promise<Record<string, unknown>> {
    const profile = { ...(await this.load(accountId)) };
    for (const field of ACORN_PROFILE_SECRET_FIELDS) delete profile[field];
    return profile;
  }
}
