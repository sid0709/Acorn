import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { AiUsageMonitorService } from './ai-usage-monitor.service';
import { AiUsageQueryService } from './ai-usage-query.service';
import {
  AiUsageMonitorQueryDto,
  AiUsageQueryDto,
} from './dto/ai-usage-query.dto';

@Controller('ai-usage')
@UseGuards(AdminGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AiUsageController {
  constructor(
    private readonly query: AiUsageQueryService,
    private readonly monitor: AiUsageMonitorService,
  ) {}

  @Get()
  list(@Query() query: AiUsageQueryDto) {
    return this.query.listRows(query);
  }

  @Get('summary')
  summary(@Query() query: AiUsageQueryDto) {
    return this.query.summary(query);
  }

  @Get('monitor')
  monitorEndpoint(@Query() query: AiUsageMonitorQueryDto) {
    return this.monitor.monitor(query);
  }
}
