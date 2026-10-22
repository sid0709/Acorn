import { createHash, randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { File } from '@google-cloud/storage';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import {
  BID_RECORDINGS_PREFIX,
  DEFAULT_MAX_RECORDING_BYTES,
} from '../constants/bid-status.constants';
import { BidLifecycleService } from '../bid-lifecycle.service';
import { bidStorageSlug } from '../../resumes/lib/storage-slug';
import { appLogger } from '../../common/logger/app-logger';
import {
  beginUploadFailureMessage,
  compactStorageError,
} from './lib/begin-upload-error';
import { createGcsResumableUploadUrl } from './lib/create-resumable-upload';
import { resumableUploadOrigin } from './lib/resumable-upload-origin';
import { UploadSessionService } from './upload-session.service';

const log = appLogger('BidRecordingUploadService');

function extFromContentType(contentType: string, fileName = ''): string {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.mp4')) return 'mp4';
  if (name.endsWith('.webm')) return 'webm';
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('mp4')) return 'mp4';
  return 'webm';
}

function maxRecordingBytes(): number {
  const configured = Number(process.env.MAX_RECORDING_BYTES || '');
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_RECORDING_BYTES;
}

@Injectable()
export class BidRecordingUploadService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly uploads: UploadSessionService,
    private readonly lifecycle: BidLifecycleService,
  ) {}

  async begin(input: {
    applierName: string;
    jobId: string;
    sessionId: string;
    contentType?: string;
    fileName?: string;
    expectedBytes: number;
    expectedSha256?: string;
    uid?: string;
    origin?: string;
  }) {
    const byteCount = Number(input.expectedBytes);
    const maxBytes = maxRecordingBytes();
    if (
      !Number.isSafeInteger(byteCount) ||
      byteCount <= 0 ||
      byteCount > maxBytes
    ) {
      throw new BadRequestException({
        success: false,
        message: `Recording size must be between 1 and ${maxBytes} bytes`,
      });
    }
    const sha256 = String(input.expectedSha256 || '')
      .trim()
      .toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new BadRequestException({
        success: false,
        message: 'A valid SHA-256 is required',
      });
    }

    const uploadId = randomUUID();
    const ext = extFromContentType(input.contentType || '', input.fileName);
    const contentType = ext === 'mp4' ? 'video/mp4' : 'video/webm';
    const storagePath = `${BID_RECORDINGS_PREFIX}${bidStorageSlug(input.applierName)}/${bidStorageSlug(input.sessionId)}/${uploadId}.${ext}`;
    const bucket = this.firebase.storageBucket();
    const file = bucket.file(storagePath);
    const origin = resumableUploadOrigin(input.origin);
    let uploadUrl: string;
    try {
      uploadUrl = await createGcsResumableUploadUrl(file, {
        origin,
        contentType,
        metadata: {
          uploadId,
          uid: String(input.uid || ''),
          applierName: input.applierName,
          jobId: input.jobId,
          sessionId: input.sessionId,
          ...(sha256 ? { expectedSha256: sha256 } : {}),
        },
      });
    } catch (error) {
      const errMessage = compactStorageError(error);
      const friendly = beginUploadFailureMessage(error);
      log.error(
        {
          jobId: input.jobId,
          bucket: bucket.name,
          errName: error instanceof Error ? error.name : 'unknown',
          err: errMessage,
        },
        'recording upload begin failed',
      );
      throw new BadGatewayException({
        success: false,
        message: friendly,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await this.uploads.create({
      uploadId,
      uid: input.uid,
      applierName: input.applierName,
      jobId: input.jobId,
      sessionId: input.sessionId,
      storagePath,
      contentType,
      expectedBytes: byteCount,
      expectedSha256: sha256 || null,
    });

    return {
      success: true as const,
      uploadId,
      uploadUrl,
      storagePath,
      bucket: bucket.name,
    };
  }

  async complete(input: {
    uploadId: string;
    uid?: string;
    applyUrl?: string;
    bidderName?: string;
    durationSec?: number;
    recordedStartAt?: string;
    recordedEndAt?: string;
    markCompleted?: boolean;
  }) {
    const session = await this.uploads.findById(input.uploadId);
    if (!session) {
      throw new NotFoundException({
        success: false,
        message: 'Upload session was not found',
      });
    }
    if (session.uid && String(session.uid) !== String(input.uid || '')) {
      throw new BadRequestException({
        success: false,
        message: 'Upload session owner mismatch',
      });
    }
    if (session.status === 'completed') {
      return this.lifecycle.persistRecordingMetadata({
        applierName: session.applierName,
        jobId: session.jobId,
        storagePath: session.storagePath,
        contentType: session.contentType,
        sizeBytes: session.actualBytes || session.expectedBytes,
        sha256: session.actualSha256,
        generation: session.generation,
        sessionId: session.sessionId,
        durationSec: input.durationSec,
        recordedStartAt: input.recordedStartAt,
        recordedEndAt: input.recordedEndAt,
        markCompleted: Boolean(input.markCompleted),
        bidderName: input.bidderName,
      });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        success: false,
        message: 'Upload session expired',
      });
    }

    const bucket = this.firebase.storageBucket();
    const file = bucket.file(session.storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new BadRequestException({
        success: false,
        message: 'Storage object is not complete',
      });
    }
    const [metadata] = await file.getMetadata();
    const actualBytes = Number(metadata.size || 0);
    if (actualBytes !== Number(session.expectedBytes)) {
      await file.delete({ ignoreNotFound: true });
      await this.uploads.markRejected(session.id, { actualBytes });
      throw new BadRequestException({
        success: false,
        message: 'Uploaded recording failed byte-count validation',
      });
    }

    let actualSha256: string | null = null;
    const expectedSha = String(session.expectedSha256 || '')
      .trim()
      .toLowerCase();
    if (expectedSha) {
      const actual = await sha256File(file);
      if (actual.sha256 !== expectedSha) {
        await file.delete({ ignoreNotFound: true });
        await this.uploads.markRejected(session.id, {
          actualBytes: actual.bytes,
          actualSha256: actual.sha256,
        });
        throw new BadRequestException({
          success: false,
          message: 'Uploaded recording failed SHA-256 validation',
        });
      }
      actualSha256 = actual.sha256;
    }

    const generation = String(metadata.generation || '');
    await this.uploads.markCompleted(session.id, {
      actualBytes,
      actualSha256,
      generation,
      contentType: metadata.contentType || session.contentType,
    });

    return this.lifecycle.persistRecordingMetadata({
      applierName: session.applierName,
      jobId: session.jobId,
      storagePath: session.storagePath,
      contentType: metadata.contentType || session.contentType,
      sizeBytes: actualBytes,
      sha256: actualSha256,
      generation,
      sessionId: session.sessionId,
      durationSec: input.durationSec,
      recordedStartAt: input.recordedStartAt,
      recordedEndAt: input.recordedEndAt,
      markCompleted: Boolean(input.markCompleted),
      bidderName: input.bidderName,
    });
  }
}

async function sha256File(
  file: File,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    file
      .createReadStream()
      .on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        hash.update(chunk);
      })
      .on('error', reject)
      .on('end', () => resolve());
  });
  return { sha256: hash.digest('hex'), bytes };
}
