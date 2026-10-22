import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  BulkUploadResumesDto,
  ListResumesQueryDto,
  OwnerNameDto,
  UploadResumeDto,
} from './dto/resume.dto';
import { ResumeAnalyzeSessionService } from './resume-analyze-session.service';
import { ResumeService } from './resume.service';

@Controller('personal/user-resumes')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ResumesController {
  constructor(
    private readonly resumes: ResumeService,
    private readonly analyze: ResumeAnalyzeSessionService,
  ) {}

  @Get()
  async list(@Query() query: ListResumesQueryDto) {
    const list = await this.resumes.list(query.ownerName, {
      source: query.source,
      profileId: query.profileId,
    });
    return { success: true as const, resumes: list };
  }

  @Post()
  async upload(@Body() body: UploadResumeDto) {
    const resume = await this.resumes.create(body);
    return { success: true as const, resume };
  }

  @Post('bulk')
  async bulk(@Body() body: BulkUploadResumesDto) {
    const result = await this.resumes.bulkCreate(body);
    return { success: true as const, ...result };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Query('ownerName') ownerName: string) {
    const resume = await this.resumes.get(id, ownerName);
    return { success: true as const, resume };
  }

  @Put(':id/primary')
  async setPrimary(@Param('id') id: string, @Body() body: OwnerNameDto) {
    const resume = await this.resumes.setPrimary(id, body.ownerName);
    return { success: true as const, resume };
  }

  @Post(':id/clear-analysis')
  async clearAnalysis(@Param('id') id: string, @Body() body: OwnerNameDto) {
    const resume = await this.resumes.clearAnalysis(id, body.ownerName);
    return { success: true as const, resume };
  }

  @Post(':id/analyze')
  async analyzeOne(
    @Param('id') id: string,
    @Body()
    body: OwnerNameDto & {
      force?: boolean;
      profileId?: string;
      applierName?: string;
    },
  ) {
    return this.analyze.start({
      applierName: body.applierName || body.ownerName,
      ownerName: body.ownerName,
      profileId: body.profileId,
      resumeIds: [id],
      force: Boolean(body.force),
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('ownerName') ownerName: string) {
    return this.resumes.delete(id, ownerName);
  }
}
