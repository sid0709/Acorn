import { Injectable } from '@nestjs/common';
import { AcornProfileService } from '../../acorn/acorn-profile.service';
import {
  AcornLibraryService,
  type AcornLibraryFile,
} from '../../acorn/acorn-library.service';
import {
  OAK_RECOMMENDED_RESUME_KEY,
  OAK_RUNTIME_FILE_KEY,
} from '../constants/oak.constants';
import { resumeUploadName } from './resume-file-name';

function attached(key: string, file: AcornLibraryFile, name: string) {
  return {
    key,
    name,
    mimeType: file.mimeType || 'application/octet-stream',
    base64: file.bytes.toString('base64'),
  };
}

/** Résumé files from the account's Acorn Library. */
@Injectable()
export class OakResumeFilesService {
  constructor(
    private readonly library: AcornLibraryService,
    private readonly profiles: AcornProfileService,
  ) {}

  /** The primary Library résumé (else the newest upload). */
  async primary(accountId: string, accountName: string) {
    const file = await this.library.primary(accountId);
    const name = await this.uploadName(accountId, accountName, file);
    return { file: attached(OAK_RUNTIME_FILE_KEY, file, name) };
  }

  /** One Library résumé by id, in the shape Fill uploads. */
  async byId(accountId: string, accountName: string, resumeId: string) {
    const file = await this.library.get(accountId, resumeId);
    const name = await this.uploadName(accountId, accountName, file);
    return {
      success: true as const,
      resumeId: file.id,
      stack: file.title || null,
      source: 'library' as const,
      file: {
        ...attached(OAK_RECOMMENDED_RESUME_KEY, file, name),
        originalName: file.fileName,
      },
    };
  }

  /** The profile's name with the file's own type; the account name when the profile has none. */
  private async uploadName(
    accountId: string,
    accountName: string,
    file: AcornLibraryFile,
  ): Promise<string> {
    const profile = await this.profiles.load(accountId).catch(() => ({}));
    return resumeUploadName(profileName(profile, accountName), file.fileName);
  }
}

function profileName(
  profile: Record<string, unknown>,
  accountName: string,
): string {
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const full = text(profile.fullName);
  if (full) return full;
  const parts = [profile.firstName, profile.middleName, profile.lastName]
    .map(text)
    .filter(Boolean);
  return parts.length ? parts.join(' ') : accountName;
}
