import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';

import { ExtensionsService } from '../extensions/extensions.service';

import { prenormExtensionScrapePayload } from './mappers/prenorm-scrape.mapper';
import { SaveJobService } from './save-job.service';

const MAX_JOB_BULK_SIZE = 50;

@Controller('jobs')
export class JobsIngestController {
  constructor(
    private readonly saveJobs: SaveJobService,
    private readonly extensionsService: ExtensionsService,
  ) {}

  @Post('ingest')
  @HttpCode(200)
  async ingest(@Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Request body must be an object');
    }

    const payload = body as Record<string, unknown>;

    const createdBy =
      typeof payload.createdBy === 'string' ? payload.createdBy.trim() : '';

    if (!createdBy) {
      throw new BadRequestException({
        success: false,
        error: 'createdBy is required',
      });
    }

    // Validate the extension from the database.
    const extension = await this.extensionsService.findOrCreateByKey(createdBy);
    // Supports:
    // { createdBy: "...", jobs: [...] }
    // OR one job:
    // { createdBy: "...", title: "...", ... }
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [payload];

    if (jobs.length === 0) {
      throw new BadRequestException({
        success: false,
        error: 'At least one job is required',
      });
    }

    if (jobs.length > MAX_JOB_BULK_SIZE) {
      throw new BadRequestException({
        success: false,
        error: `A bulk request may contain at most ${MAX_JOB_BULK_SIZE} jobs`,
      });
    }

    const results = [];

    let created = 0;
    let duplicate = 0;
    let errors = 0;

    for (let index = 0; index < jobs.length; index += 1) {
      try {
        const prenorm = prenormExtensionScrapePayload(jobs[index]);

        if (!prenorm.ok) {
          errors += 1;

          results.push({
            index,
            statusCode: 400,
            success: false,
            created: false,
            error: prenorm.error,
          });

          continue;
        }

        // Force the validated extension key.
        prenorm.data.createdBy = createdBy;

        const saved = await this.saveJobs.save(prenorm.data);

        if (saved.created) {
          created += 1;
        } else if (saved.duplicate) {
          duplicate += 1;
        }

        results.push({
          ...saved,
          index,
          statusCode: saved.created ? 201 : 200,
        });
      } catch (error) {
        errors += 1;

        results.push({
          index,
          statusCode: 500,
          success: false,
          created: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: true,
      results,
      summary: {
        total: jobs.length,
        created,
        duplicate,
        blocked: 0,
        errors,
      },
    };
  }
}
