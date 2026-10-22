import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isInconsistentDateTime } from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseBidReportDayRange,
  vendorTaskPooledAtRangeWhere,
  folderDayInRange,
} from './lib/bid-report-range';
import {
  BID_BOARD_SELECT,
  mapVendorTaskToBoardResult,
} from './mappers/bid-board-result.mapper';

@Injectable()
export class BidResultsListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(applierName: string, since?: string, until?: string) {
    const account = await this.requireAccount(applierName);
    const { sinceDay, untilDay } = parseBidReportDayRange(since, until);
    const tasks = await this.listBoardRows(account.name, sinceDay, untilDay);
    const results = tasks
      .map((task) => mapVendorTaskToBoardResult(task))
      .filter((row) =>
        folderDayInRange(String(row.dayKey || ''), sinceDay, untilDay),
      );
    return { success: true as const, results, total: results.length };
  }

  private async listBoardRows(
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
        select: BID_BOARD_SELECT,
        orderBy: { addedAt: 'desc' },
      });
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      return this.prisma.vendorTask.findMany({
        where,
        select: BID_BOARD_SELECT,
        orderBy: { addedAt: 'desc' },
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
