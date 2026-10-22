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
import { AutoBidProfileService } from './auto-bid-profile.service';
import { GetAutoBidProfileQueryDto } from './dto/get-auto-bid-profile.query.dto';
import { GetLlmModelsQueryDto } from './dto/get-llm-models.query.dto';
import { PersonalLlmService } from './llm/personal-llm.service';

@Controller('personal')
export class PersonalController {
  constructor(
    private readonly profiles: AutoBidProfileService,
    private readonly llm: PersonalLlmService,
  ) {}

  @Get('auto-bid-profile')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  get(@Query() query: GetAutoBidProfileQueryDto) {
    return this.profiles.get(query.applierName, query.profileId);
  }

  /** Full profile body is normalized in the service (Athens-server contract). */
  @Put('auto-bid-profile')
  upsert(@Body() body: Record<string, unknown>) {
    return this.profiles.upsert(body ?? {});
  }

  @Get('llm-models')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  llmModels(@Query() query: GetLlmModelsQueryDto) {
    return this.llm.listModels({
      providerRaw: query.provider,
      applierName: query.applierName,
      profileId: query.profileId,
      force: query.force === '1',
    });
  }

  @Post('default-model')
  setDefaultModel(@Body() body: Record<string, unknown>) {
    return this.llm.setDefaultModel(body ?? {});
  }

  @Post('llm-key-check')
  checkLlmKey(@Body() body: Record<string, unknown>) {
    return this.llm.checkKey(body ?? {});
  }
}
