import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ACORN_LIBRARY_COLLECTION,
  ACORN_LIBRARY_KIND_RESUME,
} from './acorn.constants';
import { AcornDbService } from './acorn-db.service';

type StoredLibraryRow = {
  id: string;
  accountId: string;
  kind?: string;
  fileName: string;
  title: string;
  mimeType: string;
  isPrimary: boolean;
  uploadedAt: Date;
  bytes?: { buffer: Uint8Array } | Uint8Array;
};

export type AcornLibraryFile = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  isPrimary: boolean;
  bytes: Buffer;
};

const RESUME_FILTER = {
  $or: [
    { kind: ACORN_LIBRARY_KIND_RESUME },
    { kind: { $exists: false } },
    { kind: '' },
  ],
};

/** Résumés the account uploaded on the Acorn website (`acorn_resume_library`). */
@Injectable()
export class AcornLibraryService {
  constructor(private readonly db: AcornDbService) {}

  /** One Library résumé with its file; throws when the account has none with this id. */
  async get(accountId: string, id: string): Promise<AcornLibraryFile> {
    const rows = await this.db.collection<StoredLibraryRow>(
      ACORN_LIBRARY_COLLECTION,
    );
    const row = await rows.findOne({ accountId, id, ...RESUME_FILTER });
    return this.toFile(row, `Library résumé ${id}`);
  }

  /** The account's primary résumé, else its newest upload. */
  async primary(accountId: string): Promise<AcornLibraryFile> {
    const rows = await this.db.collection<StoredLibraryRow>(
      ACORN_LIBRARY_COLLECTION,
    );
    const [row] = await rows
      .find({ accountId, ...RESUME_FILTER })
      .sort({ isPrimary: -1, uploadedAt: -1 })
      .limit(1)
      .toArray();
    return this.toFile(row, 'a Library résumé');
  }

  async hasResume(accountId: string): Promise<boolean> {
    const rows = await this.db.collection<StoredLibraryRow>(
      ACORN_LIBRARY_COLLECTION,
    );
    return Boolean(
      await rows.findOne(
        { accountId, ...RESUME_FILTER },
        { projection: { _id: 1 } },
      ),
    );
  }

  async exists(accountId: string, id: string): Promise<boolean> {
    const rows = await this.db.collection<StoredLibraryRow>(
      ACORN_LIBRARY_COLLECTION,
    );
    return Boolean(
      await rows.findOne(
        { accountId, id, ...RESUME_FILTER },
        { projection: { _id: 1 } },
      ),
    );
  }

  private toFile(
    row: StoredLibraryRow | null | undefined,
    what: string,
  ): AcornLibraryFile {
    if (!row?.bytes) {
      throw new NotFoundException({
        success: false,
        error: `No ${what} on this account. Upload one on the Acorn website.`,
      });
    }
    const raw = row.bytes instanceof Uint8Array ? row.bytes : row.bytes.buffer;
    return {
      id: row.id,
      title: row.title,
      fileName: row.fileName,
      mimeType: row.mimeType,
      isPrimary: row.isPrimary,
      bytes: Buffer.from(raw),
    };
  }
}
