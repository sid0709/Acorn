import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidLifecycleService } from './bid-lifecycle.service';
import { BidReviewEventsService } from './bid-review-events.service';
import { BidStatusQueueService } from './bid-status-queue.service';
import {
  BID_QUEUE_LIMIT,
  BID_RECORDINGS_PREFIX,
  RECORDING_URL_EXPIRES_MS,
  REJECTED_LIST_LIMIT,
} from './constants/bid-status.constants';
import { asDate } from './lib/iso';
import {
  mapTaskToBidResult,
  stripBidResultIdPrefix,
} from './mappers/bid-result.mapper';
import { rowFromVendorEmbeddedUsage } from './mappers/bid-ai-usage.mapper';
import { deriveBidUiStatus } from './mappers/bid-ui-status';
import { VendorTaskService } from './vendor-task.service';

@Injectable()
export class BidResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendorTasks: VendorTaskService,
    private readonly bidQueue: BidStatusQueueService,
    private readonly events: BidReviewEventsService,
    private readonly lifecycle: BidLifecycleService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  async getOne(applierName: string, id: string) {
    const task = await this.resolveTask(applierName, id);
    return {
      success: true as const,
      result: mapTaskToBidResult(this.vendorTasks.serialize(task)),
    };
  }

  async listRejected(applierName: string) {
    const account = await this.requireAccount(applierName);
    const tasks = await this.vendorTasks.listRejected(
      account.name,
      REJECTED_LIST_LIMIT,
    );
    const results = tasks.map((t) =>
      mapTaskToBidResult(this.vendorTasks.serialize(t)),
    );
    return { success: true as const, results, total: results.length };
  }

  async stats(applierName: string, since?: string, until?: string) {
    const account = await this.requireAccount(applierName);
    const tasks = await this.vendorTasks.listForApplier(
      account.name,
      BID_QUEUE_LIMIT,
    );
    const sinceMs = since ? Date.parse(since) : NaN;
    const untilMs = until ? Date.parse(until) : NaN;

    const filtered = tasks.filter((t) => {
      const stamps = [
        t.updatedAt,
        t.lastRejectedAt,
        t.lastResubmittedAt,
        t.completedAt,
        t.addedAt,
      ]
        .map((d) => asDate(d)?.getTime() ?? 0)
        .filter(Boolean);
      const latest = Math.max(0, ...stamps);
      if (Number.isFinite(sinceMs) && latest < sinceMs) return false;
      if (Number.isFinite(untilMs) && latest > untilMs) return false;
      return true;
    });

    const counts: Record<string, number> = {
      pending: 0,
      in_process: 0,
      submitted: 0,
      reviewed: 0,
      rejected: 0,
      skipped: 0,
    };
    let rejectFromSubmitted = 0;
    let rejectFromSkipped = 0;
    let rejectCountSum = 0;
    let resubmitCountSum = 0;
    let realRejects = 0;
    let durationSum = 0;
    let durationN = 0;

    for (const t of filtered) {
      const ui = deriveBidUiStatus(t);
      counts[ui] = (counts[ui] || 0) + 1;
      if (t.reviewStatus === 'rejected') {
        if (t.rejectSource === 'skipped') rejectFromSkipped += 1;
        else rejectFromSubmitted += 1;
      }
      const rc = Number(t.rejectCount || 0);
      const rs = Number(t.resubmitCount || 0);
      rejectCountSum += rc;
      resubmitCountSum += rs;
      if (rc > 0 && rs > 0) realRejects += Math.min(rc, rs);
      if (typeof t.biddingDurationSec === 'number') {
        durationSum += t.biddingDurationSec;
        durationN += 1;
      }
    }

    const total = filtered.length;
    return {
      success: true as const,
      stats: {
        total,
        ...counts,
        rejectFromSubmitted,
        rejectFromSkipped,
        rejectCount: rejectCountSum,
        resubmitCount: resubmitCountSum,
        realRejects,
        rejectRate: total ? rejectCountSum / total : 0,
        avgBiddingDurationSec: durationN ? durationSum / durationN : null,
      },
    };
  }

  async recordingUrl(applierName: string, pathRaw: string) {
    const account = await this.requireAccount(applierName);
    const path = String(pathRaw || '')
      .trim()
      .replace(/^\/+/, '');
    if (!path.startsWith(BID_RECORDINGS_PREFIX) || path.includes('..')) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid recording path',
      });
    }

    const tasks = await this.vendorTasks.listForApplier(account.name, 2000);
    const owned = tasks.some((t) => {
      if (t.recordingPath === path) return true;
      if (!Array.isArray(t.recordings)) return false;
      return (t.recordings as Array<{ storagePath?: string }>).some(
        (r) => r.storagePath === path,
      );
    });
    if (!owned) {
      throw new NotFoundException({
        success: false,
        message: 'Recording not found for this applier',
      });
    }

    const bucket = this.firebase.storageBucket();
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) {
      throw new NotFoundException({
        success: false,
        message: 'Recording object missing',
      });
    }
    const [metadata] = await file.getMetadata();
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + RECORDING_URL_EXPIRES_MS,
    });

    return {
      success: true as const,
      bucket: bucket.name,
      path,
      url,
      expiresInMs: RECORDING_URL_EXPIRES_MS,
      contentType: metadata.contentType || 'video/webm',
      size: Number(metadata.size || 0),
      name: path.split('/').pop() || path,
    };
  }

  async eventsForId(applierName: string, id: string) {
    const task = await this.resolveTask(applierName, id);
    const events = await this.events.listForJob(task.applierName, task.jobId);
    return { success: true as const, events };
  }

  async aiUsage(applierName: string, id: string) {
    const task = await this.resolveTask(applierName, id);
    const rows: Record<string, unknown>[] = [];

    const analysis = rowFromVendorEmbeddedUsage({
      id: `analysis:${task.id}`,
      feature: 'bid-job-analyze',
      usage: task.analysisUsage,
      requestId: task.analysisRequestId,
      at: task.analyzedAt,
      applierName: task.applierName,
      jobId: task.jobId,
    });
    if (analysis) rows.push(analysis);

    const recommend = rowFromVendorEmbeddedUsage({
      id: `recommend:${task.id}`,
      feature: 'bid-recommend-resume',
      usage: task.recommendUsage,
      requestId: task.recommendRequestId,
      at: task.recommendedAt,
      applierName: task.applierName,
      jobId: task.jobId,
    });
    if (recommend) rows.push(recommend);

    rows.sort((a, b) => {
      const aAt = String(a.createdAt || '');
      const bAt = String(b.createdAt || '');
      return bAt.localeCompare(aAt);
    });

    return {
      success: true as const,
      jobId: task.jobId,
      applierName: task.applierName,
      rows,
      total: rows.length,
    };
  }

  async updateStatus(input: {
    id: string;
    applierName: string;
    status: string;
    rejectReason?: string;
  }) {
    const account = await this.requireAccount(input.applierName);
    const task = await this.resolveTask(account.name, input.id);
    const status = String(input.status || '').trim();
    if (!['submitted', 'reviewed', 'rejected'].includes(status)) {
      throw new BadRequestException({
        success: false,
        message: 'status must be submitted, reviewed, or rejected',
      });
    }

    const wasRejected = task.reviewStatus === 'rejected';
    const now = new Date();
    const fields: Parameters<VendorTaskService['upsertFields']>[2] = {
      reviewStatus: status,
    };

    if (status === 'rejected') {
      const reason = String(input.rejectReason || '')
        .trim()
        .slice(0, 2000);
      const rejectSource = task.status === 'skipped' ? 'skipped' : 'submitted';
      fields.rejectReason = reason || null;
      fields.rejectSource = rejectSource;
      fields.lastRejectedAt = now;
      const doc = await this.vendorTasks.upsertFields(
        account.name,
        task.jobId,
        fields,
        { incRejectCount: true },
      );
      await this.events.append({
        applierName: account.name,
        jobId: task.jobId,
        vendorTaskId: doc.id,
        eventType:
          rejectSource === 'skipped' ? 'skip_to_reject' : 'reviewer_reject',
        meta: { rejectReason: reason || null },
      });
      return {
        success: true as const,
        result: mapTaskToBidResult(this.vendorTasks.serialize(doc)),
      };
    }

    if (wasRejected) {
      fields.rejectReason = null;
    }
    const doc = await this.vendorTasks.upsertFields(
      account.name,
      task.jobId,
      fields,
    );
    await this.events.append({
      applierName: account.name,
      jobId: task.jobId,
      vendorTaskId: doc.id,
      eventType: wasRejected ? 'reviewer_undo' : 'reviewer_mark_reviewed',
      meta: { status },
    });
    return {
      success: true as const,
      result: mapTaskToBidResult(this.vendorTasks.serialize(doc)),
    };
  }

  async markFixed(input: { applierName: string; jobId?: string; id?: string }) {
    const account = await this.requireAccount(input.applierName);
    const task = input.jobId
      ? await this.vendorTasks.findByApplierJob(
          account.name,
          String(input.jobId).trim(),
        )
      : await this.resolveTask(account.name, String(input.id || ''));
    if (!task) {
      throw new NotFoundException({
        success: false,
        message: 'Task not found',
      });
    }
    if (task.reviewStatus !== 'rejected') {
      throw new BadRequestException({
        success: false,
        message: 'Only rejected bids can be marked fixed',
      });
    }

    const job = await this.prisma.job.findUnique({
      where: { id: task.jobId },
    });
    if (!job) {
      throw new NotFoundException({
        success: false,
        message: 'Job not found',
      });
    }

    const now = new Date();
    const readyAt =
      (await this.bidQueue.getBidReadyAt(account.id, job.id)) ??
      task.bidReadyDate ??
      now;

    await this.bidQueue.setBidCompleted({
      profileId: account.id,
      job,
      existingBidReadyAt: readyAt,
    });

    const doc = await this.vendorTasks.upsertFields(
      account.name,
      task.jobId,
      {
        reviewStatus: 'submitted',
        status: 'done',
        completedAt: now,
        bidderInProcess: false,
        lastResubmittedAt: now,
        rejectReason: null,
        bidReadyDate: readyAt,
      },
      { incResubmitCount: true },
    );

    await this.events.append({
      applierName: account.name,
      jobId: task.jobId,
      vendorTaskId: doc.id,
      eventType: 'vendor_mark_fixed',
    });

    const serialized = this.vendorTasks.serialize(doc);
    return {
      success: true as const,
      result: mapTaskToBidResult(serialized),
      task: serialized,
    };
  }

  private async resolveTask(applierName: string, idRaw: string) {
    const account = await this.requireAccount(applierName);
    const id = stripBidResultIdPrefix(idRaw);
    let task = await this.vendorTasks.findById(id);
    if (!task && /^[a-f\d]{24}$/i.test(id)) {
      task = await this.vendorTasks.findByApplierJob(account.name, id);
    }
    if (!task || task.applierName !== account.name) {
      throw new NotFoundException({
        success: false,
        message: 'Bid result not found',
      });
    }
    return task;
  }

  private async requireAccount(applierName: string) {
    const name = String(applierName || '').trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        message: 'applierName is required',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        message: `User ${name} not found`,
      });
    }
    return account;
  }
}
