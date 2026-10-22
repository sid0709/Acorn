import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AnalyzeCoverageDto } from './dto/analyze-coverage.dto';
import { SaveGeneratorConfigDto } from './dto/save-generator-config.dto';
import { ResumeCoverageAnalyzeService } from './resume-coverage-analyze.service';
import { ResumeGeneratorConfigService } from './resume-generator-config.service';

@Controller('personal/resume-generator')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ResumeGeneratorController {
  constructor(
    private readonly config: ResumeGeneratorConfigService,
    private readonly analyzeService: ResumeCoverageAnalyzeService,
  ) {}

  @Get('config')
  getConfig(@Query('applierName') applierName?: string) {
    return this.config.get(applierName || '');
  }

  @Put('config')
  saveConfig(@Body() body: SaveGeneratorConfigDto) {
    return this.config.save(body.applierName, body.config, body.profileId);
  }

  @Post('analyze')
  analyze(@Body() body: AnalyzeCoverageDto) {
    return this.analyzeService.analyze(body);
  }
}
