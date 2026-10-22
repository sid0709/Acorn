import {
  Body,
  Controller,
  Get,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { StartResumeAnalyzeDto } from './dto/resume.dto';
import { ResumeAnalyzeSessionService } from './resume-analyze-session.service';

@Controller('resumes/analyze')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ResumeAnalyzeController {
  constructor(private readonly session: ResumeAnalyzeSessionService) {}

  @Get('status')
  status() {
    return this.session.status();
  }

  @Post('start')
  start(@Body() body: StartResumeAnalyzeDto) {
    return this.session.start(body);
  }

  @Post('stop')
  stop() {
    return this.session.stop();
  }
}
