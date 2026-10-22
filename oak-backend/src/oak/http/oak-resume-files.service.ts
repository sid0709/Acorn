import { Injectable } from '@nestjs/common';
import {
  AcornLibraryService,
  type AcornLibraryFile,
} from '../../acorn/acorn-library.service';
import {
  OAK_RECOMMENDED_RESUME_KEY,
  OAK_RUNTIME_FILE_KEY,
} from '../constants/oak.constants';

function attached(key: string, file: AcornLibraryFile) {
  return {
    key,
    name: file.fileName,
    mimeType: file.mimeType || 'application/octet-stream',
    base64: file.bytes.toString('base64'),
  };
}

/** Résumé files from the account's Acorn Library. */
@Injectable()
export class OakResumeFilesService {
  constructor(private readonly library: AcornLibraryService) {}

  /** The primary Library résumé (else the newest upload). */
  async primary(accountId: string) {
    const file = await this.library.primary(accountId);
    return { file: attached(OAK_RUNTIME_FILE_KEY, file) };
  }

  /** One Library résumé by id, in the shape Fill uploads. */
  async byId(accountId: string, resumeId: string) {
    const file = await this.library.get(accountId, resumeId);
    return {
      success: true as const,
      resumeId: file.id,
      stack: file.title || null,
      source: 'library' as const,
      file: attached(OAK_RECOMMENDED_RESUME_KEY, file),
    };
  }
}
