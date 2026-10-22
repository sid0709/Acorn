import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobStatusApplyBulkService } from './job-status-apply-bulk.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_APPLY = 500;

@Injectable()
export class JobCompanyApplyOthersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applyBulk: JobStatusApplyBulkService,
  ) {}

  async applyOthers(input: {
    applierName: string;
    companyId: string;
    keepJobIds: string[];
    includeQueued?: boolean;
  }) {
    const applierName = String(input.applierName || '').trim();
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }

    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: `User ${applierName} not found`,
      });
    }

    const keep = new Set(
      (Array.isArray(input.keepJobIds) ? input.keepJobIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => OBJECT_ID_RE.test(id)),
    );
    const companyId = await this.resolveCompanyId(input.companyId, keep);
    const targets = await this.siblingJobIds(companyId, keep);
    const appliedIds = await this.applyBulk.setApplied(account.id, targets, {
      skipQueued: input.includeQueued !== true,
    });
    return {
      success: true as const,
      appliedCount: appliedIds.length,
      appliedIds,
    };
  }

  private async resolveCompanyId(
    raw: string,
    keep: Set<string>,
  ): Promise<string> {
    const companyId = String(raw || '').trim();
    if (OBJECT_ID_RE.test(companyId)) return companyId;
    const keepId = [...keep][0];
    if (!keepId) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid company id',
      });
    }
    const job = await this.prisma.job.findUnique({
      where: { id: keepId },
      select: { companyId: true },
    });
    const resolved = String(job?.companyId || '').trim();
    if (!OBJECT_ID_RE.test(resolved)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid company id',
      });
    }
    return resolved;
  }

  private async siblingJobIds(
    companyId: string,
    keep: Set<string>,
  ): Promise<string[]> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { jobIds: true },
    });
    let ids = (company?.jobIds ?? [])
      .map((id) => String(id || '').trim())
      .filter((id) => OBJECT_ID_RE.test(id) && !keep.has(id))
      .slice(0, MAX_APPLY);
    if (!ids.length) {
      const rows = await this.prisma.job.findMany({
        where: { companyId },
        select: { id: true },
        take: MAX_APPLY,
      });
      return rows.map((row) => row.id).filter((id) => !keep.has(id));
    }
    const rows = await this.prisma.job.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
