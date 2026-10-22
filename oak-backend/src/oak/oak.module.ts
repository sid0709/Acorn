import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { OakAuthController } from './auth/oak-auth.controller';
import { OakAuthGuard } from './auth/oak-auth.guard';
import { OakAuthService } from './auth/oak-auth.service';
import { OakSessionService } from './auth/oak-session.service';
import { OakAnalyzeService } from './ai/oak-analyze.service';
import { OakIdentityService } from './ai/oak-identity.service';
import { OakMatchOptionService } from './ai/oak-match-option.service';
import { OakProseService } from './ai/oak-prose.service';
import { OakQaService } from './ai/oak-qa.service';
import { OakProfilePromptService } from './ai/oak-profile-prompt.service';
import { OakResponsesService } from './ai/oak-responses.service';
import { OakGatewayBootstrap } from './gateway/oak-gateway.bootstrap';
import { OakController } from './http/oak.controller';
import { OakJdShotService } from './http/oak-jd-shot.service';
import { OakSentService } from './http/oak-sent.service';
import { OakResumeFilesService } from './http/oak-resume-files.service';
import { OakFillPolicyService } from './policy/oak-fill-policy.service';

@Module({
  imports: [AiModule],
  controllers: [OakAuthController, OakController],
  providers: [
    OakSessionService,
    OakAuthService,
    OakAuthGuard,
    OakProfilePromptService,
    OakResponsesService,
    OakAnalyzeService,
    OakProseService,
    OakQaService,
    OakIdentityService,
    OakMatchOptionService,
    OakResumeFilesService,
    OakJdShotService,
    OakSentService,
    OakFillPolicyService,
    OakGatewayBootstrap,
  ],
  exports: [OakGatewayBootstrap, OakSessionService],
})
export class OakModule {}
