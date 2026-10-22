import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { BidResultsService } from './bid-results.service';
import { BidResultsListService } from './bid-results-list.service';
import { BidResultsReportService } from './bid-results-report.service';
import { MarkFixedDto } from './dto/mark-fixed.dto';
import { BidReportQueryDto } from './dto/bid-report.query.dto';
import { UpdateBidResultStatusDto } from './dto/update-bid-result-status.dto';

@Controller('bid-results')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class BidResultsController {
  constructor(
    private readonly bids: BidResultsService,
    private readonly listRows: BidResultsListService,
    private readonly report: BidResultsReportService,
  ) {}

  @Get()
  list(
    @Query('applierName') applierName: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    return this.listRows.list(applierName, since, until);
  }

  @Get('rejected')
  listRejected(@Query('applierName') applierName: string) {
    return this.bids.listRejected(applierName);
  }

  @Get('stats')
  stats(
    @Query('applierName') applierName: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    return this.bids.stats(applierName, since, until);
  }

  @Get('report')
  bidReport(@Query() query: BidReportQueryDto) {
    return this.report.report(query.applierName, query.since, query.until);
  }

  @Get('recording-url')
  recordingUrl(
    @Query('applierName') applierName: string,
    @Query('path') path: string,
  ) {
    return this.bids.recordingUrl(applierName, path);
  }

  @Get(':id/events')
  events(@Param('id') id: string, @Query('applierName') applierName: string) {
    return this.bids.eventsForId(applierName, id);
  }

  @Get(':id/ai-usage')
  aiUsage(@Param('id') id: string, @Query('applierName') applierName: string) {
    return this.bids.aiUsage(applierName, id);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Query('applierName') applierName: string) {
    return this.bids.getOne(applierName, id);
  }

  @Patch(':id')
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateBidResultStatusDto,
  ) {
    return this.bids.updateStatus({
      id,
      applierName: body.applierName,
      status: body.status,
      rejectReason: body.rejectReason,
    });
  }

  @Post('mark-fixed')
  markFixed(@Body() body: MarkFixedDto) {
    return this.bids.markFixed(body);
  }
}
