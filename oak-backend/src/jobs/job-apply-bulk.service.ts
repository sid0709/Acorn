import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobStatusApplyBulkService } from './job-status-apply-bulk.service';

@Injectable()
export class JobApplyBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applyBulk: JobStatusApplyBulkService,
  ) {}

  async apply(applierName: string, jobIds: string[]) {
    const name = String(applierName || '').trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: `User ${name} not found`,
      });
    }
    const appliedIds = await this.applyBulk.setApplied(account.id, jobIds, {
      skipQueued: false,
    });
    return {
      success: true as const,
      appliedCount: appliedIds.length,
      appliedIds,
    };
  }
}
