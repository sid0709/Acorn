import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { storageSlug } from './lib/storage-slug';

const SIGNED_URL_EXPIRES_MS = 15 * 60_000;

export type StoredResumeObject = {
  storagePath: string;
  contentSha256: string;
  sizeBytes: number;
};

/**
 * Firebase Storage for resume binaries.
 * Default path: `{slug(ownerName)}_{profileId}/{folder}/{sha256}`
 * Job-linked PDFs use a stable `{folder}/{objectKey}` instead of the hash.
 */
@Injectable()
export class ResumeStorageService {
  private readonly logger = new Logger(ResumeStorageService.name);

  constructor(private readonly admin: FirebaseAdminService) {}

  buildPath(
    ownerName: string,
    profileId: string,
    contentSha256: string,
    folder = 'resumes',
  ): string {
    return `${storageSlug(ownerName)}_${profileId}/${folder}/${contentSha256}`;
  }

  sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async put(input: {
    ownerName: string;
    profileId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folder?: string;
    objectKey?: string;
  }): Promise<StoredResumeObject> {
    const contentSha256 = this.sha256(input.buffer);
    const objectKey = String(input.objectKey || '').trim() || contentSha256;
    const storagePath = this.buildPath(
      input.ownerName,
      input.profileId,
      objectKey,
      input.folder,
    );
    const bucket = this.admin.storageBucket();
    const file = bucket.file(storagePath);
    await file.save(input.buffer, {
      contentType: input.mimeType || 'application/octet-stream',
      resumable: false,
      metadata: {
        metadata: {
          ownerName: input.ownerName,
          profileId: input.profileId,
          originalFileName: input.fileName,
          sha256: contentSha256,
        },
      },
    });
    return {
      storagePath,
      contentSha256,
      sizeBytes: input.buffer.length,
    };
  }

  async download(storagePath: string): Promise<Buffer | null> {
    const normalized = String(storagePath || '').replace(/^\/+/, '');
    if (!normalized) return null;
    try {
      const [buf] = await this.admin
        .storageBucket()
        .file(normalized)
        .download();
      return buf;
    } catch (err) {
      this.logger.warn(
        `Resume download failed (${normalized}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async signedReadUrl(storagePath: string): Promise<string | null> {
    const normalized = String(storagePath || '').replace(/^\/+/, '');
    if (!normalized) return null;
    try {
      const [url] = await this.admin
        .storageBucket()
        .file(normalized)
        .getSignedUrl({
          action: 'read',
          expires: Date.now() + SIGNED_URL_EXPIRES_MS,
          version: 'v4',
        });
      return url;
    } catch {
      return null;
    }
  }

  /**
   * Permanently remove the Storage object. Missing objects are ignored;
   * other Firebase errors propagate so callers do not silently orphan blobs.
   */
  async delete(storagePath: string): Promise<void> {
    const normalized = String(storagePath || '').replace(/^\/+/, '');
    if (!normalized) return;
    try {
      await this.admin
        .storageBucket()
        .file(normalized)
        .delete({ ignoreNotFound: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Resume Storage delete failed (${normalized}): ${message}`,
      );
      throw new Error(`Failed to delete resume file from Storage: ${message}`);
    }
  }
}
