import {
  Body,
  Controller,
  Get,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { StartAiSessionDto } from '../dto/start-ai-session.dto';
import { AiAnalyzeSessionService } from './ai-analyze-session.service';

@Controller('jobs/ai-analyze')
export class AiAnalyzeController {
  constructor(private readonly session: AiAnalyzeSessionService) {}

  @Get('status')
  status() {
    return this.session.status();
  }

  @Post('start')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  start(@Body() body: StartAiSessionDto) {
    return this.session.start(body);
  }

  @Post('stop')
  stop() {
    return this.session.stop();
  }
}
