import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ADMIN_APPLIER_HEADER } from '../../common/constants/admin.constants';
import { AddCompanyBlockDto } from './dto/add-company-block.dto';
import { RemoveCompanyBlockJobsDto } from './dto/remove-company-block-jobs.dto';
import { SearchCompanyBlockDto } from './dto/search-company-block.dto';
import { CompanyBlockService } from './company-block.service';

@Controller('company-blocks')
@UseGuards(AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CompanyBlockController {
  constructor(private readonly blocks: CompanyBlockService) {}

  @Get()
  list() {
    return this.blocks.list();
  }

  @Post()
  add(
    @Body() body: AddCompanyBlockDto,
    @Headers(ADMIN_APPLIER_HEADER) requester: string,
  ) {
    return this.blocks.add(body.companyName, String(requester || '').trim());
  }

  @Post('search')
  search(@Body() body: SearchCompanyBlockDto) {
    return this.blocks.search(body.companyName);
  }

  @Post('remove')
  removeJobs(@Body() body: RemoveCompanyBlockJobsDto) {
    return this.blocks.removeJobs(body.ids);
  }

  @Delete(':id')
  removeRule(
    @Param('id') id: string,
    @Headers(ADMIN_APPLIER_HEADER) requester: string,
  ) {
    return this.blocks.removeRule(id, String(requester || '').trim());
  }
}
