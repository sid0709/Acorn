import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { prenormLiScrapePayload } from './mappers/prenorm-scrape.mapper';
import { SaveJobService } from './save-job.service';

@Controller('jobs/ingest')
@UsePipes(new ValidationPipe({ whitelist: false, transform: true }))
export class ExposeJobsController {
  constructor(private readonly saveJobs: SaveJobService) {}

  /** LI-scrapper ingest — single object or `{ jobs: [...] }`. */
  @Post()
  async ingest(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;

    if (payload && Array.isArray(payload.jobs)) {
      if (payload.jobs.length === 0) {
        res.status(400);
        return { success: false, error: 'jobs array cannot be empty' };
      }

      const results = [];
      for (let i = 0; i < payload.jobs.length; i += 1) {
        const prenorm = prenormLiScrapePayload(payload.jobs[i]);
        if (!prenorm.ok) {
          res.status(400);
          return { success: false, error: `jobs[${i}]: ${prenorm.error}` };
        }
        results.push(await this.saveJobs.save(prenorm.data));
      }

      const created = results.filter((r) => r.created).length;
      const duplicates = results.filter((r) => r.duplicate).length;
      const blocked = results.filter((r) => r.blocked).length;
      res.status(created > 0 ? 201 : 200);
      return { success: true, created, duplicates, blocked, results };
    }

    const prenorm = prenormLiScrapePayload(body);
    if (!prenorm.ok) {
      res.status(400);
      return { success: false, error: prenorm.error };
    }

    const result = await this.saveJobs.save(prenorm.data);
    if (result.duplicate || result.blocked) {
      res.status(200);
      return result;
    }
    res.status(201);
    return result;
  }

  /** LI-scrapper existence check by jobID (metadata.legacyId). */
  @Post('check')
  @HttpCode(200)
  async check(@Body() body: unknown) {
    const raw =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const jobIDRaw = raw.jobID ?? raw.job_id ?? raw.jobId;
    const jobID =
      typeof jobIDRaw === 'string' || typeof jobIDRaw === 'number'
        ? String(jobIDRaw).trim()
        : '';
    if (!jobID) {
      throw new BadRequestException({
        success: false,
        error: 'jobID is required',
      });
    }
    const exists = await this.saveJobs.existsByLegacyId(jobID);
    return { success: true, exists };
  }
}
