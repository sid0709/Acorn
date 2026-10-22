import {
  Body,
  Controller,
  Get,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AiAnalyzeSessionService } from './ai-analyze/ai-analyze-session.service';
import { StartAiSessionDto } from './dto/start-ai-session.dto';

/** Legacy route alias for AI Analyze (old “Extract skills” client paths). */
@Controller('jobs/skill-extract')
export class SkillExtractController {
  constructor(private readonly aiAnalyze: AiAnalyzeSessionService) {}

  @Get('status')
  status() {
    return this.aiAnalyze.status();
  }

  @Post('start')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  start(@Body() body: StartAiSessionDto) {
    return this.aiAnalyze.start(body);
  }

  @Post('stop')
  stop() {
    return this.aiAnalyze.stop();
  }
}
