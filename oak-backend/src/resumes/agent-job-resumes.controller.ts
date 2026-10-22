import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { AgentJobResumesService } from './agent-job-resumes.service';

class AgentJobResumesStatusDto {
  @IsString()
  applierName!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  jobIds!: string[];
}

/**
 * Legacy Athens-server paths used by Job Search (generated-résumé badges).
 * Full generate/delete pipeline is not ported yet; status returns library hits only.
 */
@Controller('personal/agent-job-resumes')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AgentJobResumesController {
  constructor(private readonly agentResumes: AgentJobResumesService) {}

  @Post('status')
  status(@Body() body: AgentJobResumesStatusDto) {
    return this.agentResumes.status(body.applierName, body.jobIds);
  }
}
