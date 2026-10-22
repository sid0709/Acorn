import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isInconsistentDateTime } from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import {
  folderDayInRange,
  parseBidReportDayRange,
  vendorTaskPooledAtRangeWhere,
} from './lib/bid-report-range';
import {
  BID_REPORT_SELECT,
  mapVendorTaskToReportRow,
} from './mappers/bid-report.mapper';

@Injectable()
export class BidResultsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(applierName: string, since?: string, until?: string) {
    const account = await this.requireAccount(applierName);
    const { sinceDay, untilDay } = parseBidReportDayRange(since, until);
    const tasks = await this.listRows(account.name, sinceDay, untilDay);
    const data = tasks
      .map((task) => mapVendorTaskToReportRow(task))
      .filter((row) => folderDayInRange(row.dayKey, sinceDay, untilDay))
      .sort(
        (a, b) =>
          a.dayKey.localeCompare(b.dayKey) ||
          a.company.localeCompare(b.company) ||
          a.title.localeCompare(b.title),
      );
    return { success: true as const, data };
  }

  private async listRows(
    applierName: string,
    sinceDay: string,
    untilDay: string,
  ) {
    const where = {
      applierName,
      ...vendorTaskPooledAtRangeWhere(sinceDay, untilDay),
    };
    try {
      return await this.prisma.vendorTask.findMany({
        where,
        select: BID_REPORT_SELECT,
      });
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      return this.prisma.vendorTask.findMany({
        where,
        select: BID_REPORT_SELECT,
      });
    }
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
      select: { name: true },
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
