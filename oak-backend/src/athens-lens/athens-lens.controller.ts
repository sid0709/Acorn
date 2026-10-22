import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BidLifecycleService } from '../bids/bid-lifecycle.service';
import { BidRecordingUploadService } from '../bids/recording/bid-recording-upload.service';
import { LensAuthGuard, type LensAuthedRequest } from './lens-auth.guard';
import { LensGmailService } from './lens-gmail.service';
import { LensJobsService } from './lens-jobs.service';

@Controller('athens-lens')
@UseGuards(LensAuthGuard)
export class AthensLensController {
  constructor(
    private readonly jobs: LensJobsService,
    private readonly lifecycle: BidLifecycleService,
    private readonly recordings: BidRecordingUploadService,
    private readonly gmail: LensGmailService,
  ) {}

  @Get('jobs')
  listJobs(@Req() req: LensAuthedRequest) {
    return this.jobs.list(req.athensLensSession!.applierName);
  }

  @Post('bids/start')
  startBid(
    @Req() req: LensAuthedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.lifecycle.start({
      applierName: req.athensLensSession!.applierName,
      jobId: String(body.jobId || ''),
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      bidderName: body.bidderName
        ? String(body.bidderName)
        : req.athensLensSession!.applierName,
      applyUrl: body.applyUrl ? String(body.applyUrl) : undefined,
    });
  }

  @Post('bids/complete')
  completeBid(
    @Req() req: LensAuthedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.lifecycle.complete({
      applierName: req.athensLensSession!.applierName,
      jobId: String(body.jobId || ''),
      bidderName: body.bidderName
        ? String(body.bidderName)
        : req.athensLensSession!.applierName,
      biddingDurationSec:
        typeof body.biddingDurationSec === 'number'
          ? body.biddingDurationSec
          : undefined,
    });
  }

  @Post('bids/skip')
  skipBid(
    @Req() req: LensAuthedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.lifecycle.skip({
      applierName: req.athensLensSession!.applierName,
      jobId: String(body.jobId || ''),
      bidderName: body.bidderName
        ? String(body.bidderName)
        : req.athensLensSession!.applierName,
      skipReason: body.skipReason ? String(body.skipReason) : undefined,
    });
  }

  @Post('bids/analysis')
  saveAnalysis(
    @Req() req: LensAuthedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.lifecycle.persistAnalysis({
      applierName: req.athensLensSession!.applierName,
      jobId: String(body.jobId || ''),
      summary: body.summary ? String(body.summary) : undefined,
      answers: Array.isArray(body.answers)
        ? (body.answers as Array<{
            question?: string;
            suggestedAnswer?: string;
            answer?: string;
            confidence?: string;
          }>)
        : [],
      pageUrl: body.pageUrl ? String(body.pageUrl) : undefined,
      pageTitle: body.pageTitle ? String(body.pageTitle) : undefined,
      mode: body.mode ? String(body.mode) : undefined,
      usage:
        body.usage && typeof body.usage === 'object'
          ? (body.usage as Record<string, unknown>)
          : undefined,
      requestId: body.requestId ? String(body.requestId) : undefined,
    });
  }

  @Post('bids/resume-audit')
  resumeAudit(
    @Req() req: LensAuthedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.lifecycle.saveResumeAudit({
      applierName: req.athensLensSession!.applierName,
      jobId: String(body.jobId || ''),
      originalName: String(body.originalName || ''),
      expectedName: body.expectedName ? String(body.expectedName) : undefined,
      cleanedName: body.cleanedName ? String(body.cleanedName) : undefined,
      company: body.company ? String(body.company) : undefined,
      title: body.title ? String(body.title) : undefined,
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      source: body.source ? String(body.source) : undefined,
      fileSize: typeof body.fileSize === 'number' ? body.fileSize : undefined,
      mimeType: body.mimeType ? String(body.mimeType) : undefined,
      auditKey: body.auditKey ? String(body.auditKey) : undefined,
    });
  }

  @Post('bids/recordings/uploads')
  @HttpCode(201)
  beginUpload(
    @Req() req: LensAuthedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.recordings.begin({
      applierName: req.athensLensSession!.applierName,
      jobId: String(body.jobId || ''),
      sessionId: String(body.sessionId || ''),
      contentType: body.contentType ? String(body.contentType) : undefined,
      fileName: body.fileName ? String(body.fileName) : undefined,
      expectedBytes: Number(body.byteCount ?? body.expectedBytes ?? 0),
      expectedSha256: body.sha256 ? String(body.sha256) : undefined,
      uid: req.athensLensSession!.accountId,
      origin: body.origin ? String(body.origin) : undefined,
    });
  }

  @Post('bids/recordings/uploads/:uploadId/complete')
  completeUpload(
    @Req() req: LensAuthedRequest,
    @Param('uploadId') uploadId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.recordings.complete({
      uploadId,
      uid: req.athensLensSession!.accountId,
      applyUrl: body.applyUrl ? String(body.applyUrl) : undefined,
      bidderName: body.bidderName
        ? String(body.bidderName)
        : req.athensLensSession!.applierName,
      durationSec:
        typeof body.durationSec === 'number' ? body.durationSec : undefined,
      recordedStartAt: body.recordedStartAt
        ? String(body.recordedStartAt)
        : undefined,
      recordedEndAt: body.recordedEndAt
        ? String(body.recordedEndAt)
        : undefined,
      markCompleted: Boolean(body.markCompleted),
    });
  }

  @Get('gmail/messages')
  gmailMessages(
    @Req() req: LensAuthedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('label') label?: string,
  ) {
    return this.gmail.listMessages(req.athensLensSession!.applierName, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 15,
      label: label || undefined,
    });
  }

  @Get('gmail/message-bodies')
  gmailBodies(
    @Req() req: LensAuthedRequest,
    @Query('ids') ids?: string,
    @Query('label') label?: string,
  ) {
    const idList = String(ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.gmail.listBodies(
      req.athensLensSession!.applierName,
      idList,
      label || undefined,
    );
  }
}
