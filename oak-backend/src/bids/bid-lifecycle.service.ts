import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BidReviewEventsService } from './bid-review-events.service';
import { BidStatusQueueService } from './bid-status-queue.service';
import { inferJobSource } from '../jobs/lib/infer-job-source';
import { normalizeJobMetadata } from '../jobs/mappers/job-metadata.mapper';
import {
  buildProfileResumeFileName,
  isResumeNameMismatch,
  resolveResumeOriginalName,
  resumeExtFromName,
} from './lib/resume-audit';
import { autoBidFullName } from '../personal/lib/auto-bid-full-name';
import { matchUploadToRecommended } from './lib/resume-catalog';
import { mapTaskToBidResult } from './mappers/bid-result.mapper';
import { SKIP_REASON_MAX_LENGTH } from './constants/bid-status.constants';
import { VendorTaskService } from './vendor-task.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

@Injectable()
export class BidLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendorTasks: VendorTaskService,
    private readonly events: BidReviewEventsService,
    private readonly bidQueue: BidStatusQueueService,
  ) {}

  async start(input: {
    applierName: string;
    jobId: string;
    sessionId?: string;
    bidderName?: string;
    applyUrl?: string;
  }) {
    const { account, job } = await this.requireAccountAndJob(
      input.applierName,
      input.jobId,
    );
    const now = new Date();
    const { bidReadyAt } = await this.bidQueue.setBidReady({
      profileId: account.id,
      applierName: account.name,
      job,
    });

    const meta = normalizeJobMetadata(job.metadata) ?? {};
    const applyUrl = input.applyUrl?.trim() || job.applyLink || null;
    const doc = await this.vendorTasks.upsertFields(account.name, job.id, {
      title: job.title || 'Untitled role',
      company: job.companyName || '',
      applyUrl,
      source: job.source || inferJobSource(applyUrl),
      location: meta.details?.location ?? '',
      workMode: meta.details?.remote ?? '',
      status: 'pending',
      bidderInProcess: true,
      bidderInProcessAt: now,
      bidderName: input.bidderName?.trim() || null,
      bidSessionId: input.sessionId?.trim() || null,
      bidReadyDate: bidReadyAt,
      reviewStatus: null,
    });

    await this.events.append({
      applierName: account.name,
      jobId: job.id,
      vendorTaskId: doc.id,
      eventType: 'apply_start',
      meta: { from: 'pending', to: 'in_process' },
    });

    return { success: true as const, task: this.vendorTasks.serialize(doc) };
  }

  async complete(input: {
    applierName: string;
    jobId: string;
    bidderName?: string;
    biddingDurationSec?: number;
  }) {
    const { account, job } = await this.requireAccountAndJob(
      input.applierName,
      input.jobId,
    );
    const existing = await this.vendorTasks.findByApplierJob(
      account.name,
      job.id,
    );
    const now = new Date();
    let duration =
      typeof input.biddingDurationSec === 'number'
        ? input.biddingDurationSec
        : null;
    if (duration == null && existing?.bidderInProcessAt instanceof Date) {
      duration = Math.max(
        0,
        (now.getTime() - existing.bidderInProcessAt.getTime()) / 1000,
      );
    }

    const readyAt =
      (await this.bidQueue.getBidReadyAt(account.id, job.id)) ??
      existing?.bidReadyDate ??
      now;

    await this.bidQueue.setBidCompleted({
      profileId: account.id,
      job,
      existingBidReadyAt: readyAt,
    });

    const doc = await this.vendorTasks.upsertFields(account.name, job.id, {
      status: 'done',
      completedAt: now,
      bidderInProcess: false,
      reviewStatus: 'submitted',
      bidderName: input.bidderName?.trim() || existing?.bidderName || null,
      biddingDurationSec: duration,
      bidReadyDate: readyAt,
    });

    await this.events.append({
      applierName: account.name,
      jobId: job.id,
      vendorTaskId: doc.id,
      eventType: 'submit',
    });

    const task = this.vendorTasks.serialize(doc);
    return {
      success: true as const,
      task,
      result: mapTaskToBidResult(task),
    };
  }

  async skip(input: {
    applierName: string;
    jobId: string;
    bidderName?: string;
    skipReason?: string;
  }) {
    const { account, job } = await this.requireAccountAndJob(
      input.applierName,
      input.jobId,
    );
    const now = new Date();
    const readyAt =
      (await this.bidQueue.getBidReadyAt(account.id, job.id)) ??
      (await this.vendorTasks.findByApplierJob(account.name, job.id))
        ?.bidReadyDate ??
      now;

    await this.bidQueue.setBidCompleted({
      profileId: account.id,
      job,
      existingBidReadyAt: readyAt,
    });

    const skipReason =
      String(input.skipReason || '')
        .trim()
        .slice(0, SKIP_REASON_MAX_LENGTH) || null;

    const doc = await this.vendorTasks.upsertFields(account.name, job.id, {
      status: 'skipped',
      completedAt: now,
      bidderInProcess: false,
      reviewStatus: null,
      biddingDurationSec: null,
      bidderName: input.bidderName?.trim() || null,
      bidReadyDate: readyAt,
      skipReason,
    });

    await this.events.append({
      applierName: account.name,
      jobId: job.id,
      vendorTaskId: doc.id,
      eventType: 'skip',
      meta: { skipReason },
    });

    const task = this.vendorTasks.serialize(doc);
    return {
      success: true as const,
      task,
      result: mapTaskToBidResult(task),
    };
  }

  async persistAnalysis(input: {
    applierName: string;
    jobId: string;
    summary?: string;
    answers?: Array<{
      question?: string;
      suggestedAnswer?: string;
      answer?: string;
      confidence?: string;
    }>;
    pageUrl?: string;
    pageTitle?: string;
    mode?: string;
    usage?: Record<string, unknown>;
    requestId?: string;
  }) {
    const { account, job } = await this.requireAccountAndJob(
      input.applierName,
      input.jobId,
    );
    const answers = (input.answers || [])
      .map((a) => ({
        question: String(a.question || '').trim(),
        suggestedAnswer: String(a.suggestedAnswer || a.answer || '').trim(),
        confidence: ['high', 'medium', 'low'].includes(String(a.confidence))
          ? String(a.confidence)
          : 'medium',
      }))
      .filter((a) => a.question);

    const doc = await this.vendorTasks.upsertFields(account.name, job.id, {
      analysisSummary: input.summary?.trim() || null,
      analysisFormAnswers: answers,
      analysisMode:
        input.mode === 'llm' || input.mode === 'heuristic' ? input.mode : 'llm',
      analysisPageUrl: input.pageUrl?.trim() || null,
      analysisPageTitle: input.pageTitle?.trim() || null,
      analysisUsage: (input.usage ?? undefined) as
        Prisma.InputJsonValue | undefined,
      analysisRequestId: input.requestId?.trim() || null,
      analyzedAt: new Date(),
    });

    return {
      success: true as const,
      jobId: job.id,
      formCount: answers.length,
      taskId: doc.id,
    };
  }

  async saveResumeAudit(input: {
    applierName: string;
    jobId: string;
    originalName: string;
    expectedName?: string;
    cleanedName?: string;
    company?: string;
    title?: string;
    sessionId?: string;
    source?: string;
    fileSize?: number;
    mimeType?: string;
    auditKey?: string;
  }) {
    const { account, job } = await this.requireAccountAndJob(
      input.applierName,
      input.jobId,
    );
    const originalName = resolveResumeOriginalName({
      originalName: input.originalName,
      cleanedName: input.cleanedName,
    });
    if (!originalName) {
      throw new BadRequestException({
        success: false,
        message: 'originalName is required',
      });
    }

    const ext = resumeExtFromName(originalName);
    const expectedName =
      String(input.expectedName || '').trim() ||
      buildProfileResumeFileName(
        autoBidFullName(account.autoBidProfile, account.name),
        ext,
      );
    const cleanedName = String(input.cleanedName || '').trim() || originalName;
    const renamed = cleanedName !== originalName;
    const mismatch = isResumeNameMismatch(cleanedName, expectedName);

    const existing = await this.vendorTasks.findByApplierJob(
      account.name,
      job.id,
    );
    const stackMatch = matchUploadToRecommended(
      originalName,
      existing?.recommendedResumeStack,
    );

    const auditKey =
      String(input.auditKey || '').trim() ||
      [
        input.sessionId || '',
        originalName,
        cleanedName,
        input.fileSize || 0,
        input.mimeType || '',
      ].join('|');

    const priorAudits = Array.isArray(existing?.resumeAudits)
      ? (existing.resumeAudits as Array<Record<string, unknown>>)
      : [];
    const duplicate = priorAudits.some((a) => a.auditKey === auditKey);
    const auditEntry = {
      originalName,
      expectedName,
      cleanedName,
      renamed,
      mismatch,
      sessionId: input.sessionId?.trim() || null,
      source: input.source?.trim() || null,
      fileSize: typeof input.fileSize === 'number' ? input.fileSize : null,
      mimeType: input.mimeType?.trim() || null,
      auditKey,
      recordedAt: new Date().toISOString(),
    };
    const resumeAudits = duplicate ? priorAudits : [...priorAudits, auditEntry];

    const doc = await this.vendorTasks.upsertFields(account.name, job.id, {
      resumeOriginalName: originalName,
      resumeExpectedName: expectedName,
      resumeCleanedName: cleanedName,
      resumeRenamed: renamed,
      resumeMismatch: mismatch,
      resumeStackMatch: stackMatch,
      resumeAudits: resumeAudits as unknown as Prisma.InputJsonValue,
      ...(input.company ? { company: input.company } : {}),
      ...(input.title ? { title: input.title } : {}),
    });

    if (mismatch && !duplicate) {
      await this.events.append({
        applierName: account.name,
        jobId: job.id,
        vendorTaskId: doc.id,
        eventType: 'resume_name_mismatch',
        eventKey: `resume:${auditKey}`,
        meta: { originalName, expectedName, cleanedName },
      });
    }

    const task = this.vendorTasks.serialize(doc);
    return {
      success: true as const,
      audit: auditEntry,
      task,
      result: mapTaskToBidResult(task),
    };
  }

  async persistRecordingMetadata(input: {
    applierName: string;
    jobId: string;
    storagePath: string;
    contentType: string;
    sizeBytes: number;
    sha256?: string | null;
    generation?: string | null;
    sessionId: string;
    durationSec?: number | null;
    recordedStartAt?: string | null;
    recordedEndAt?: string | null;
    markCompleted: boolean;
    bidderName?: string | null;
  }) {
    const { account, job } = await this.requireAccountAndJob(
      input.applierName,
      input.jobId,
    );
    const existing = await this.vendorTasks.findByApplierJob(
      account.name,
      job.id,
    );
    const now = new Date();
    const readyAt =
      (await this.bidQueue.getBidReadyAt(account.id, job.id)) ??
      existing?.bidReadyDate ??
      now;

    const prior = Array.isArray(existing?.recordings)
      ? (existing.recordings as Array<Record<string, unknown>>)
      : [];
    const entry = {
      storagePath: input.storagePath,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      sessionId: input.sessionId,
      sha256: input.sha256 || null,
      generation: input.generation || null,
      durationSec:
        typeof input.durationSec === 'number' ? input.durationSec : null,
      recordedStartAt: input.recordedStartAt || null,
      recordedEndAt: input.recordedEndAt || null,
      uploadedAt: now.toISOString(),
    };
    const withoutSameSession = prior.filter(
      (r) => String(r.sessionId || '') !== input.sessionId,
    );
    const recordings = [...withoutSameSession, entry];

    let biddingDurationSec: number | null =
      existing?.biddingDurationSec ?? null;
    if (input.markCompleted && existing?.bidderInProcessAt) {
      biddingDurationSec = Math.max(
        0,
        (now.getTime() - existing.bidderInProcessAt.getTime()) / 1000,
      );
    }

    const fields = {
      recordingPath: input.storagePath,
      recordingContentType: input.contentType,
      recordingSize: input.sizeBytes,
      recordingSha256: input.sha256 || null,
      recordingGeneration: input.generation || null,
      recordingDurationSec:
        typeof input.durationSec === 'number' ? input.durationSec : null,
      recordingStartedAt: input.recordedStartAt
        ? new Date(input.recordedStartAt)
        : null,
      recordingEndedAt: input.recordedEndAt
        ? new Date(input.recordedEndAt)
        : null,
      recordings: recordings as unknown as Prisma.InputJsonValue,
      bidSessionId: input.sessionId,
      bidderName: input.bidderName || existing?.bidderName || null,
      bidReadyDate: readyAt,
      ...(input.markCompleted
        ? {
            status: 'done',
            completedAt: now,
            bidderInProcess: false,
            reviewStatus: 'submitted' as const,
            biddingDurationSec,
          }
        : {
            bidderInProcess: true,
            status: 'pending' as const,
          }),
    };

    if (input.markCompleted) {
      await this.bidQueue.setBidCompleted({
        profileId: account.id,
        job,
        existingBidReadyAt: readyAt,
      });
    }

    const doc = await this.vendorTasks.upsertFields(
      account.name,
      job.id,
      fields,
    );

    if (input.markCompleted) {
      await this.events.append({
        applierName: account.name,
        jobId: job.id,
        vendorTaskId: doc.id,
        eventType: 'submit',
      });
    }

    const task = this.vendorTasks.serialize(doc);
    return {
      success: true as const,
      recording: {
        storagePath: input.storagePath,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256 || null,
        generation: input.generation || null,
        sessionId: input.sessionId,
      },
      task,
      result: mapTaskToBidResult(task),
    };
  }

  private async requireAccountAndJob(applierName: string, jobIdRaw: string) {
    const jobId = String(jobIdRaw || '').trim();
    const name = String(applierName || '').trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        message: 'applierName is required',
      });
    }
    if (!OBJECT_ID_RE.test(jobId)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid job id',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: { id: true, name: true, autoBidProfile: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        message: `User ${name} not found`,
      });
    }
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        success: false,
        message: 'Job not found',
      });
    }
    return { account, job };
  }
}
