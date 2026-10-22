import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { prenormExtensionScrapePayload } from './mappers/prenorm-scrape.mapper';
import { SaveJobService } from './save-job.service';

const MAX_JOB_BULK_SIZE = 50;

@Controller('jobs')
export class JobsBulkController {
  constructor(private readonly saveJobs: SaveJobService) {}

  /** Extension scrape queue — `{ jobs: [...] }` → per-index results. */
  @Post('ingest')
  @HttpCode(200)
  async bulk(@Body() body: unknown) {
    const jobs =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { jobs?: unknown }).jobs
        : null;

    if (!Array.isArray(jobs)) {
      return {
        success: false,
        error: 'Request body must contain a jobs array',
      };
    }
    if (jobs.length === 0) {
      return { success: false, error: 'At least one job is required' };
    }
    if (jobs.length > MAX_JOB_BULK_SIZE) {
      return {
        success: false,
        error: `A bulk request may contain at most ${MAX_JOB_BULK_SIZE} jobs`,
      };
    }

    const results = [];
    let created = 0;
    let duplicate = 0;
    let blocked = 0;
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
        const saved = await this.saveJobs.save(prenorm.data);
        if (saved.created) created += 1;
        else if (saved.duplicate) duplicate += 1;
        else if (saved.blocked) blocked += 1;
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
        blocked,
        errors,
      },
    };
  }
}
