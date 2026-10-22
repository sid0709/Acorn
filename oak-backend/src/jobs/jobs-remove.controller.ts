import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpException,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  RemoveJobsDto,
  RemoveOtherCompanyJobsDto,
} from './dto/remove-jobs.dto';
import { JobHardDeleteService } from './job-hard-delete.service';

@Controller('jobs')
export class JobsRemoveController {
  constructor(private readonly hardDelete: JobHardDeleteService) {}

  /** Permanent hard delete from catalog `jobs`. */
  @Post('remove')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async remove(@Body() body: RemoveJobsDto) {
    if (!body.ids?.length) {
      throw new BadRequestException({
        success: false,
        error: 'Missing ids array',
        message: 'Missing ids array',
      });
    }
    return this.hardDelete.deleteCatalogJobs(body.ids);
  }

  /** Permanent hard delete of other roles at the same company. */
  @Post('company/remove-others')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async removeOthers(@Body() body: RemoveOtherCompanyJobsDto) {
    try {
      return await this.hardDelete.deleteOtherCompanyJobs(body);
    } catch (err) {
      const error = err as Error & { code?: string; status?: number };
      if (error.code === 'COMPANY_GROUP_CHANGED') {
        throw new ConflictException({
          success: false,
          error: error.message,
          message: error.message,
        });
      }
      if (error instanceof HttpException) throw error;
      throw error;
    }
  }
}
